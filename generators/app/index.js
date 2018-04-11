'use strict'
const Generator = require('yeoman-generator')
const chalk = require('chalk')
const yosay = require('yosay')
const FuzzySearch = require('fuzzy-search')
const Promise = require('bluebird')
const Please = require('request-promise')
const Request = require('request')
const Fs = require('fs')
const Unzipper = require('unzipper')
const Spinner = require('cli-spinner').Spinner

module.exports = class extends Generator {
  prompting () {
    this.env.adapter.promptModule.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'))
    this.log(
      yosay(`Welcome to the ${chalk.yellow('spring')} generator! [${chalk.blue('generator-spring')}]`)
    )

    this.log()
    const spinner = new Spinner(`We'll try and get ${chalk.yellow('Spring Initialzr')} info from ${chalk.red('https://start.spring.io')}: %s`)
    spinner.setSpinnerString('◐◓◑◒')
    // spinner.setSpinnerString('|/-\\')
    spinner.start()
    const spring = Please({
      uri: 'https://start.spring.io',
      headers: {
        'User-Agent': 'Request-Promise',
        'Accept': 'application/vnd.initializr.v2.1+json'
      },
      json: true
    }).then(spring => {
      return spring
    }).catch(err => {
      spinner.stop(true)
      this.log(`We failed to get the most up-to-date ${chalk.yellow('Spring Initialzr')} info. We'll use some cached data instead.`)
      return require('./spring.json')
    })

    return spring.then(spring => {
      spinner.stop(true)
      const optionMapping = {
        packaging: `How do you want your app to be ${chalk.yellow('packaged')}?`,
        javaVersion: `Which ${chalk.yellow('Java version')} do you want to use?`,
        language: `Which ${chalk.yellow('language')} do you want to use?`,
        bootVersion: `Which ${chalk.yellow('Spring Boot version')} do you want to use?`,
        groupId: `What's your ${chalk.yellow('group ID')}?`,
        artifactId: `What's your ${chalk.yellow('artifact ID')}?`,
        version: `What ${chalk.yellow('version')} do you want to start at?`,
        name: `What's the ${chalk.yellow('name')} of your app?`,
        description: `${chalk.yellow('Describe')} your app in a few words:`,
        packageName: `Your app's ${chalk.yellow('package name')} will be as follows:`,
        dependencies: `Pick and choose the ${chalk.yellow('dependencies')} you want to use:`
      }

      const dependencies = spring.dependencies.values.map(it => {
        return {
          values: it.values.map(value => {
            value.name = `${chalk.cyanBright(it.name)} ${value.name}`
            return value
          }
          )
        }
      }).reduce((acc, it) => acc.concat(it.values), []).map(it => {
        return {
          name: it.name,
          value: it.id
        }
      })

      const prompts = [
      ]

      Object.entries(spring).filter(item => {
        return item[1].type === 'text'
      }).forEach(entry => {
        prompts.push({
          type: 'input',
          name: entry[0],
          message: answers => {
            return optionMapping[entry[0]] || `${entry[0]}`
          },
          default: answers => {
            if (entry[0] === 'packageName' && (answers.groupId || answers.artifactId)) {
              return this.config.get(entry[0]) || `${answers.groupId}.${answers.artifactId}`
            } else {
              return this.config.get(entry[0]) || entry[1].default
            }
          },
          when: answers => {
            return true
          }
        })
      })

      Object.entries(spring).filter(item => {
        return item[1].type === 'single-select'
      }).forEach(entry => {
        prompts.push({
          type: 'list',
          name: entry[0],
          message: optionMapping[entry[0]] || `${entry[0]}`,
          choices: entry[1].values.map(it => {
            return {
              name: it.name,
              value: it.id
            }
          }),
          default: this.config.get(entry[0]) || entry[1].default,
          when: answers => {
            return true
          }
        })
      })

      Object.entries(spring).filter(item => {
        return item[1].type === 'hierarchical-multi-select'
      }).forEach(entry => {
        prompts.push({
          type: 'checkbox-plus',
          name: entry[0],
          message: answers => {
            return optionMapping[entry[0]] || `${entry[0]}`
          },
          default: answers => {
            return this.config.get(entry[0]) || []
          },
          when: answers => {
            return true
          },
          highlight: true,
          searchable: true,
          source: (answers, filter) => new Promise(resolve => resolve(new FuzzySearch(dependencies, ['name']).search(filter)))
        })
      })

      prompts.push({
        type: 'list',
        name: 'toolchain',
        message: `Which ${chalk.yellow('toolchain')} do you want to use?`,
        choices: [
          {
            value: 'gradle',
            name: 'Gradle'
          },
          {
            value: 'maven',
            name: 'Maven'
          }
        ],
        default: answers => this.config.get('toolchain'),
        when: answers => {
          return true
        }
      })

      prompts.push({
        type: 'list',
        name: 'format',
        message: `In which ${chalk.yellow('format')} do you want to download your app?`,
        choices: [
          {
            value: 'project',
            name: 'Project archive file (ZIP)'
          },
          {
            value: 'build',
            name: 'Build descriptor file'
          }
        ],
        default: answers => this.config.get('format'),
        when: answers => {
          return true
        }
      })

      prompts.push({
        type: 'confirm',
        name: 'extract',
        message: `Do you want to ${chalk.yellow('extract/initialise')} the project after downloading?`,
        default: answers => this.config.get('format'),
        when: answers => {
          return answers.format === 'project'
        }
      })

      return this.prompt(prompts).then(props => {
        // To access props later use this.props.someAnswer;
        this.props = props
        Object.entries(props).forEach(entry => {
          this.config.set(entry[0], entry[1])
        })
      })
    })
  }

  writing () {
    const springOptions = Object.assign({}, this.props)
    springOptions.format = null
    springOptions.toolchain = null
    springOptions.extract = null

    const postDownload = (build) => {
      if (this.props.extract && build) {
        const shell = process.platform === 'win32' ? 'cmd' : 'sh'
        const tool = this.props.toolchain === 'gradle' ? 'gradle' : 'mvn'
        const command = this.props.toolchain === 'gradle' ? 'build' : 'package'
        const extension = process.platform === 'win32' ? '.bat' : ''

        // the unzip stream contents seem to be not immediatly ready =(
        setTimeout(() => {
          this.log(`Extracted ${chalk.yellow(this.props.name)}${chalk.yellow('.zip')}.`)
          this.log(`We'll now let ${chalk.yellow(this.props.toolchain)} download your ${chalk.yellow('dependencies')} and run a basic ${chalk.yellow('build')}:`)
          this.spawnCommandSync(shell, [`./${tool}w${extension}`, `${command}`])

          this.log(yosay(`Thank you for using the ${chalk.yellow('spring')} generator! [${chalk.blue('generator-spring')}]`))
        }, 500)
      } else {
        this.log(yosay(`Thank you for using the ${chalk.yellow('spring')} generator! [${chalk.blue('generator-spring')}]`))
      }
    }

    const out = this.props.extract ? Unzipper.Extract({ path: '.' }) : Fs.createWriteStream(`${this.props.name}.zip`)

    const spinner = new Spinner(`We'll now download your project as generated by ${chalk.yellow('Spring Initializr')}: %s`)
    spinner.setSpinnerString('◐◓◑◒')
    // spinner.setSpinnerString('|/-\\')
    spinner.start()

    if (this.props.toolchain === 'gradle' && this.props.format === 'build') {
      Request({
        uri: 'https://start.spring.io/build.gradle?type=gradle-build',
        qs: springOptions,
        headers: {
          'User-Agent': 'Request-Promise'
        }
      })
      .on('error', err => {
        spinner.stop(true)
        this.log(yosay(`We're terribly sorry but we couldn't get your project files from ${chalk.red('https://start.spring.io')}: ${err}`))
        this.log(`${chalk.red(err)}`)
      })
      .pipe(Fs.createWriteStream('build.gradle'))
      .on('close', () => {
        spinner.stop(true)
        this.log(`Downloaded ${chalk.yellow('build.gradle')}.`)
        postDownload(false)
      })
    } else if (this.props.toolchain === 'gradle' && this.props.format === 'project') {
      Request({
        uri: 'https://start.spring.io/starter.zip?type=gradle-project',
        qs: springOptions,
        headers: {
          'User-Agent': 'Request-Promise'
        }
      })
      .on('error', err => {
        spinner.stop(true)
        this.log(yosay(`We're terribly sorry but we couldn't get your project files from ${chalk.red('https://start.spring.io')}: ${err}`))
        this.log(`${chalk.red(err)}`)
      })
      .pipe(out)
      .on('close', () => {
        spinner.stop(true)
        this.log(`Downloaded ${chalk.yellow(this.props.name)}${chalk.yellow('.zip')}.`)
        postDownload(true)
      })
    } else if (this.props.toolchain === 'maven' && this.props.format === 'build') {
      Request({
        uri: 'https://start.spring.io/pom.xml?type=maven-build',
        qs: springOptions,
        headers: {
          'User-Agent': 'Request-Promise'
        }
      })
      .on('error', err => {
        spinner.stop(true)
        this.log(yosay(`We're terribly sorry but we couldn't get your project files from ${chalk.red('https://start.spring.io')}: ${err}`))
        this.log(`${chalk.red(err)}`)
      })
      .pipe(Fs.createWriteStream('pom.xml'))
      .on('close', () => {
        spinner.stop(true)
        this.log(`Downloaded ${chalk.yellow('pom.xml')}.`)
        postDownload(false)
      })
    } else if (this.props.toolchain === 'maven' && this.props.format === 'project') {
      Request({
        uri: 'https://start.spring.io/starter.zip?type=maven-project',
        qs: springOptions,
        headers: {
          'User-Agent': 'Request-Promise'
        }
      })
      .on('error', err => {
        spinner.stop(true)
        this.log(yosay(`We're terribly sorry but we couldn't get your project files from ${chalk.red('https://start.spring.io')}: ${err}`))
        this.log(`${chalk.red(err)}`)
      })
      .pipe(out)
      .on('close', () => {
        spinner.stop(true)
        this.log(`Downloaded ${chalk.yellow(this.props.name)}${chalk.yellow('.zip')}.`)
        postDownload(true)
      })
    }
  }

  install () {
  }
}
