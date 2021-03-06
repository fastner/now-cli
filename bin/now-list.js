#!/usr/bin/env node

// Packages
const minimist = require('minimist')
const chalk = require('chalk')
const ms = require('ms')
const printf = require('printf')
require('epipebomb')()
const supportsColor = require('supports-color')

// Ours
const Now = require('../lib')
const login = require('../lib/login')
const cfg = require('../lib/cfg')
const { handleError, error } = require('../lib/error')
const logo = require('../lib/utils/output/logo')
const sort = require('../lib/sort-deployments')

const argv = minimist(process.argv.slice(2), {
  string: ['config', 'token'],
  boolean: ['help', 'debug', 'all'],
  alias: {
    help: 'h',
    config: 'c',
    debug: 'd',
    token: 't'
  }
})

const help = () => {
  console.log(`
  ${chalk.bold(`${logo} now list`)} [app]

  ${chalk.dim('Options:')}

    -h, --help              Output usage information
    -c ${chalk.bold.underline('FILE')}, --config=${chalk.bold.underline(
    'FILE'
  )}  Config file
    -d, --debug             Debug mode [off]
    -t ${chalk.bold.underline('TOKEN')}, --token=${chalk.bold.underline(
    'TOKEN'
  )} Login token

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} List all deployments

    ${chalk.cyan('$ now ls')}

  ${chalk.gray('–')} List all deployments for the app ${chalk.dim('`my-app`')}

    ${chalk.cyan('$ now ls my-app')}

  ${chalk.dim('Alias:')} ls
`)
}

if (argv.help) {
  help()
  process.exit(0)
}

const app = argv._[0]

// Options
const debug = argv.debug
const apiUrl = argv.url || 'https://api.zeit.co'

if (argv.config) {
  cfg.setConfigFile(argv.config)
}

Promise.resolve()
  .then(async () => {
    const config = await cfg.read({ token: argv.token })

    let token
    try {
      token = config.token || (await login(apiUrl))
    } catch (err) {
      error(`Authentication error – ${err.message}`)
      process.exit(1)
    }

    try {
      await list({ token, config })
    } catch (err) {
      error(`Unknown error: ${err}\n${err.stack}`)
      process.exit(1)
    }
  })
  .catch(err => {
    handleError(err)
    process.exit(1)
  })

async function list({ token, config: { currentTeam, user } }) {
  const now = new Now({ apiUrl, token, debug, currentTeam })
  const start = new Date()

  if (argv.all && !app) {
    console.log('> You must define an app when using `--all`')
    process.exit(1)
  }
  let deployments
  try {
    deployments = await now.list(app)
  } catch (err) {
    handleError(err)
    process.exit(1)
  }

  if (!deployments || (Array.isArray(deployments) && deployments.length <= 0)) {
    const match = await now.findDeployment(app)
    if (match !== null && typeof match !== 'undefined') {
      deployments = Array.of(match)
    }
  }
  if (!deployments || (Array.isArray(deployments) && deployments.length <= 0)) {
    const aliases = await now.listAliases()

    const item = aliases.find(e => e.uid === app || e.alias === app)
    if (item) {
      const match = await now.findDeployment(item.deploymentId)
      if (match !== null && typeof match !== 'undefined') {
        deployments = Array.of(match)
      }
    }
  }

  now.close()

  const apps = new Map()

  if (argv.all) {
    await Promise.all(
      deployments.map(async ({ uid }, i) => {
        deployments[i].instances = await now.listInstances(uid)
      })
    )
  }

  for (const dep of deployments) {
    const deps = apps.get(dep.name) || []
    apps.set(dep.name, deps.concat(dep))
  }

  const sorted = await sort([...apps])

  const urlLength =
    deployments.reduce((acc, i) => {
      return Math.max(acc, (i.url && i.url.length) || 0)
    }, 0) + 5
  const timeNow = new Date()
  console.log(
    `> ${deployments.length} deployment${deployments.length === 1
      ? ''
      : 's'} found under ${chalk.bold(
      (currentTeam && currentTeam.slug) || user.username || user.email
    )} ${chalk.grey('[' + ms(timeNow - start) + ']')}`
  )

  let shouldShowAllInfo = false
  for (const app of apps) {
    shouldShowAllInfo =
      app[1].length > 5 ||
      app.find(depl => {
        return depl.scale && depl.scale.current > 1
      })
    if (shouldShowAllInfo) {
      break
    }
  }
  if (!argv.all && shouldShowAllInfo) {
    console.log(
      `> To expand the list and see instances run ${chalk.cyan(
        '`now ls --all [app]`'
      )}`
    )
  }
  console.log()
  sorted.forEach(([name, deps]) => {
    const listedDeployments = argv.all ? deps : deps.slice(0, 5)
    console.log(
      `${chalk.bold(name)} ${chalk.gray(
        '(' + listedDeployments.length + ' of ' + deps.length + ' total)'
      )}`
    )
    const urlSpec = `%-${urlLength}s`
    console.log(
      printf(
        ` ${chalk.grey(urlSpec + '  %8s    %-16s %8s')}`,
        'url',
        'inst #',
        'state',
        'age'
      )
    )
    listedDeployments.forEach(dep => {
      let state = dep.state
      let extraSpaceForState = 0
      if (state === null || typeof state === 'undefined') {
        state = 'DEPLOYMENT_ERROR'
      }
      if (/ERROR/.test(state)) {
        state = chalk.red(state)
        extraSpaceForState = 10
      } else if (state === 'FROZEN') {
        state = chalk.grey(state)
        extraSpaceForState = 10
      }
      let spec
      if (supportsColor) {
        spec = ` %-${urlLength + 10}s %8s    %-${extraSpaceForState + 16}s %8s`
      } else {
        spec = ` %-${urlLength + 1}s %8s    %-${16}s %8s`
      }

      console.log(
        printf(
          spec,
          chalk.underline(dep.url),
          dep.scale ? dep.scale.current : '✖',
          state,
          ms(timeNow - dep.created)
        )
      )
      if (Array.isArray(dep.instances) && dep.instances.length > 0) {
        dep.instances.forEach(i => {
          console.log(
            printf(` %-${urlLength + 10}s`, ` - ${chalk.underline(i.url)}`)
          )
        })
        console.log()
      }
    })
    console.log()
  })
}
