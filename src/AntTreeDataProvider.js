const vscode = require('vscode')
const _ = require('lodash')
const filehelper = require('./filehelper')
const path = require('path')
const BuildFileParser = require('./BuildFileParser.js')
const messageHelper = require('./messageHelper')

var darkDefault
var lightDefault
var darkTarget
var lightTarget
var darkDependency
var lightDependency

var configOptions
var selectedAntTarget

module.exports = class AntTreeDataProvider {
  constructor (context) {
    this.extensionContext = context

    darkTarget = vscode.Uri.file(
      path.join(context.extensionPath, 'dist', 'resources', 'icons', 'dark', 'target.svg')
    )
    lightTarget = vscode.Uri.file(
      path.join(context.extensionPath, 'dist', 'resources', 'icons', 'light', 'target.svg')
    )
    darkDefault = vscode.Uri.file(
      path.join(context.extensionPath, 'dist', 'resources', 'icons', 'dark', 'default.svg')
    )
    lightDefault = vscode.Uri.file(
      path.join(context.extensionPath, 'dist', 'resources', 'icons', 'light', 'default.svg')
    )
    darkDependency = vscode.Uri.file(
      path.join(context.extensionPath, 'dist', 'resources', 'icons', 'dark', 'dependency.svg')
    )
    lightDependency = vscode.Uri.file(
      path.join(context.extensionPath, 'dist', 'resources', 'icons', 'light', 'dependency.svg')
    )

    this.targetRunner = null
    this.targets = null
    this.project = null
    this.buildFilenames = 'build.xml'
    this.buildFileDirectories = '.'
    this.eventListeners = []

    this.rootPaths = []
    this.buildFileParsers = []

    var workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        this.rootPaths.push(folder.uri.fsPath)
        this.buildFileParsers.push(new BuildFileParser(folder.uri.fsPath))
      }

      // this.rootPath = workspaceFolders[0].uri.fsPath
      // // this.watchBuildXml(workspaceFolders)
      // this.BuildFileParser = new BuildFileParser(workspaceFolders[0].uri.fsPath)
    }

    // event for notify of change of data
    this._onDidChangeTreeData = new vscode.EventEmitter()
    this.onDidChangeTreeData = this._onDidChangeTreeData.event

    // trap config and workspaces changes to pass updates
    var onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this))
    this.extensionContext.subscriptions.push(onDidChangeConfiguration)

    var onDidChangeWorkspaceFolders = vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders.bind(this))
    this.extensionContext.subscriptions.push(onDidChangeWorkspaceFolders)

    this.getConfigOptions()
  }

  onDidChangeConfiguration () {
    this.getConfigOptions()
    this.refresh()
  }

  onDidChangeWorkspaceFolders () {
    var workspaceFolders = vscode.workspace.workspaceFolders

    if (workspaceFolders) {
      this.rootPaths = []
      this.buildFileParsers = []
  
      for (const folder of workspaceFolders) {
        this.rootPaths.push(folder.uri.fsPath)
        this.buildFileParsers.push(new BuildFileParser(folder.uri.fsPath))
      }
      // this.rootPath = workspaceFolders[0].uri.fsPath
      // this.BuildFileParser = new BuildFileParser(workspaceFolders[0].uri.fsPath)
    }

    this.refresh()
  }

  watchBuildFile (rootPath, buildFileName) {
    const buildFile = filehelper.getRootFile(this.rootPath, buildFileName)
    this.watchFile(buildFile)
  }

  watchFile (globPattern) {
    var fileSystemWatcher = vscode.workspace.createFileSystemWatcher(globPattern)
    this.extensionContext.subscriptions.push(fileSystemWatcher)

    this.eventListeners.push({
      filename: globPattern,
      fileSystemWatcher: fileSystemWatcher,
      didChangeListener: fileSystemWatcher.onDidChange(() => {
        this.refresh()
      }, this, this.extensionContext.subscriptions),
      didDeleteListener: fileSystemWatcher.onDidDelete(() => {
        this.refresh()
      }, this, this.extensionContext.subscriptions),
      didCreateListener: fileSystemWatcher.onDidCreate(() => {
        this.refresh()
      }, this, this.extensionContext.subscriptions)
    })
  }

  getConfigOptions () {
    configOptions = vscode.workspace.getConfiguration('ant', null)
    this.sortTargetsAlphabetically = configOptions.get('sortTargetsAlphabetically', 'true')
    this.buildFilenames = configOptions.get('buildFilenames', 'build.xml')
    if (this.buildFilenames === '' || typeof this.buildFilenames === 'undefined') {
      this.buildFilenames = 'build.xml'
    }
    this.buildFileDirectories = configOptions.get('buildFileDirectories', '.')
    if (this.buildFileDirectories === '' || typeof this.buildFileDirectories === 'undefined') {
      this.buildFileDirectories = '.'
    }
  }

  removeSubscription (item) {
    this.extensionContext.subscriptions.splice(this.extensionContext.subscriptions.indexOf(item), 1)
  }

  refresh () {
    // remove event listeners
    for (const eventListener of this.eventListeners) {
      eventListener.didChangeListener.dispose()
      eventListener.didDeleteListener.dispose()
      eventListener.didCreateListener.dispose()
      eventListener.fileSystemWatcher.dispose()
    }
    this.eventListeners = []

    this._onDidChangeTreeData.fire()
  }

  getTreeItem (element) {
    if (element.contextValue === 'antFile') {
      let treeItem = {
        id: element.filePath,
        contextValue: element.contextValue,
        label: element.fileName,
        command: '',
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        tooltip: element.filePath
      }
      if (element.project) {
        treeItem.label = `${element.fileName}    (${element.project})`
      }
      return treeItem
    } else if (element.contextValue === 'antTarget') {
      let treeItem = {
        id: element.name,
        label: element.name,
        command: {
          arguments: [element],
          command: 'vscode-ant.selectedAntTarget',
          title: 'selectedAntTarget'
        },
        contextValue: 'antTarget',
        tooltip: `${element.description} (${element.sourceFile})`
      }
      // can be expanded for depends?
      if (element.depends) {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
      } else {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None
      }
      if (element.name === this.project.default) {
        treeItem.iconPath = {
          light: lightDefault,
          dark: darkDefault
        }
      } else {
        treeItem.iconPath = {
          light: lightTarget,
          dark: darkTarget
        }
      }

      return treeItem
    } else if (element.contextValue === 'antDepends') {
      let treeItem = {
        label: element.name,
        command: {
          arguments: [element],
          command: 'vscode-ant.selectedAntTarget',
          title: 'selectedAntTarget'
        },
        contextValue: 'antDepends',
        tooltip: `${element.description} (${element.sourceFile})`,
        iconPath: {
          light: lightDependency,
          dark: darkDependency
        }
      }
      // can be expanded for depends?
      if (element.depends) {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
      } else {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None
      }
      return treeItem
    } else {
      return element
    }
  }

  getChildren (element) {
    if (this.rootPaths.length <= 0) {
      messageHelper.showInformationMessage('No build.xml in empty workspace.')
      return new Promise((resolve, reject) => {
        resolve([])
        reject(new Error('Failed somehow'))
      })
    }
    return new Promise(async (resolve, reject) => {
      // add root elements?
      if (!element) {
        try {
          var roots = []
          for (let i = 0; i < this.rootPaths.length; i++) {
            roots.push(await this.getRoots(this.rootPaths[i], this.buildFileParsers[i]))
          }
          resolve(roots)
        } catch (err) {
          console.log(err)
          resolve([])
        }
        // this.getRoots()
        //   .then((roots) => {
        //     resolve(roots)
        //   })
        //   .catch((err) => {
        //     console.log(err)
        //     resolve([])
        //   })
      } else {
        if (element.contextValue === 'antFile' && element.filePath) {
          this.getTargetsInProject()
            .then((targets) => {
              resolve(targets)
            })
            .catch((err) => {
              console.log(err)
              resolve([])
            })
        } else if (element.contextValue === 'antTarget' && element.depends) {
          this.getDependsInTarget(element)
            .then((depends) => {
              resolve(depends)
            })
            .catch((err) => {
              console.log(err)
              resolve([])
            })
        } else if (element.contextValue === 'antDepends' && element.depends) {
          this.getDependsInTarget(element)
            .then((depends) => {
              resolve(depends)
            })
            .catch((err) => {
              console.log(err)
              resolve([])
            })
        } else {
          resolve([])
          reject(new Error('Something went wrong!'))
        }
      }
    })
  }

  getRoots (rootPath, buildFileParser) {
    return new Promise(async (resolve, reject) => {
      try {
        var buildFilename = await buildFileParser.findBuildFile(this.buildFileDirectories.split(','), this.buildFilenames.split(','))
      } catch (error) {
        messageHelper.showInformationMessage('Workspace has no build.xml files.')
        return resolve([])
      }

      try {
        var buildFileObj = await buildFileParser.parseBuildFile(buildFilename)
      } catch (error) {
        messageHelper.showErrorMessage('Error reading ' + buildFilename + '!')
        return reject(new Error('Error reading build.xml!: ' + error))
      }

      try {
        var projectDetails = await buildFileParser.getProjectDetails(buildFileObj)
        var [buildTargets, buildSourceFiles] = await buildFileParser.getTargets(buildFilename, buildFileObj, [], [])

        messageHelper.showInformationMessage('Targets loaded from ' + buildFilename + '!')

        // const buildSourceFiles = _.uniq(_.map(buildTargets, 'sourceFile'))
        for (const buildSourceFile of buildSourceFiles) {
          this.watchBuildFile(rootPath, buildSourceFile)
        }

        var root = {
          id: buildFilename,
          contextValue: 'antFile',
          filePath: path.dirname(buildFilename),
          fileName: path.basename(buildFilename),
          project: projectDetails.name
        }

        this.project = projectDetails
        this.targets = buildTargets

        resolve([root])
      } catch (error) {
        messageHelper.showErrorMessage('Error parsing build.xml!')
        return reject(new Error('Error parsing build.xml!:' + error))
      }
    })
  }

  getTargetsInProject () {
    return new Promise((resolve) => {
      // var targets = project.target.map((target) => {
      //   var antTarget = {
      //     id: target.$.name,
      //     contextValue: 'antTarget',
      //     depends: target.$.depends,
      //     name: target.$.name
      //   }
      //   return antTarget
      // })
      let targets = this.targets.map((target) => {
        var antTarget = {
          id: target.name,
          contextValue: 'antTarget',
          sourceFile: target.sourceFile,
          depends: target.depends,
          description: target.description,
          name: target.name
        }
        return antTarget
      })
      resolve(this._sort(targets))
    })
  }

  setParentValues (o) {
    if (o.target) {
      for (let n in o.target) {
        o.target[n].parent = o
        this.setParentValues(o.target[n])
      }
    }
    return o
  }

  getDependsInTarget (element) {
    return new Promise((resolve) => {
      var depends = element.depends.split(',').map((depends) => {
        var dependsTarget = {
          id: depends,
          contextValue: 'antDepends',
          name: depends,
          description: '',
          sourceFile: ''
        }
        // get details of this target
        var target = _.find(this.targets, (o) => {
          if (o.name === depends) {
            return true
          }
          return false
        })
        if (target) {
          dependsTarget.depends = target.depends
          dependsTarget.sourceFile = target.sourceFile
          dependsTarget.description = target.description
        }
        return dependsTarget
      })
      resolve(depends)
    })
  }

  selectedAntTarget (targetElement) {
    selectedAntTarget = targetElement
  }

  runSelectedAntTarget () {
    if (selectedAntTarget && this.targetRunner) {
      var target = selectedAntTarget.name
      if (target.indexOf(' ') >= 0) {
        target = '"' + target + '"'
      }
      this.targetRunner.runAntTarget({name: target, sourceFile: selectedAntTarget.sourceFile})
    }
  }

  _sort (nodes) {
    if (!this.sortTargetsAlphabetically) {
      return nodes
    }

    return nodes.sort((n1, n2) => {
      if (n1.name < n2.name) {
        return -1
      } else if (n1.name > n2.name) {
        return 1
      } else {
        return 0
      }
    })
  }
}
