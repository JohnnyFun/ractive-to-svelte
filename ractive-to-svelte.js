// https://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search
var fs = require('fs');
var path = require('path');
var walk = function (dir, done) {
  var results = [];
  fs.readdir(dir, function (err, list) {
    if (err) return done(err);
    var pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function (file) {
      file = path.resolve(dir, file);
      fs.stat(file, function (err, stat) {
        if (stat && stat.isDirectory()) {
          walk(file, function (err, res) {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
};

// walk through the ractive components, making global replaces to convert ractive syntax to svelte syntax
const srcFolder = path.join(__dirname, '../client/js')
const convertToOutputDir = path => path.replace('client\\js', 'client\\js-svelte')
const todoConvert = 'TODO CONVERT'
let stores = {}
let svelteImports = []
const skipFiles = [
  // as you get files completed, you can include them here, so your manual changes don't get overwritten
  /\\(api|string-utils)\.js$/i,
  /\\(input-checkbox|main-content|btn)\.html$/i
]

walk(srcFolder, (err, results) => {
  if (err) throw err

  const convertFiles = (ext, extNew, convertFunc) => {
    const files = results.filter(r => path.extname(r) === ext)
    console.log(`Processing ${files.length} ${ext} files...`)
    return files
      .filter(rc => !skipFiles.some(f => f.test(rc)))
      .map(rc => {
        return new Promise((res, rej) => {
          fs.readFile(rc, (err, file) => {
            // conversions
            file = file.toString()
            file = convertFunc(file, rc)
            file = file.trim()

            // write to output location
            const fileName = (extNew === '.svelte' ? toUpperName(path.basename(rc, ext)) : path.basename(rc, ext)) + extNew
            const to = path.join(convertToOutputDir(path.dirname(rc)), fileName)
            return writeFile(to, file).then(res)
          })
        })
      })
  }

  const tasks = [
    ...convertFiles('.html', '.svelte', (file, filePath) => {
      svelteImports = []
      file = convertRequiresToImports(file)
      file = convertImportedHtmlToSvelte(file)
      file = convertSharedToStore(file)
      file = convertFireToDispatch(file)
      file = convertRactiveScriptContents(file, filePath)
      file = convertGetSet(file)
      file = convertLinksToImports(file)
      file = convertEventHandlers(file)
      file = convertYieldToSlot(file)
      file = convertIfStatements(file)
      file = convertEachStatementsHaveAliases(file)
      file = convertDoubleBracketsToSingle(file)
      file = convertSimpleProps(file)
      file = convertClassProps(file)
      file = convertRactiveHelpers(file)
      file = convertToolTipDecorator(file)
      if (svelteImports.length > 0)
        file = insertAtBeginningOfScript(file, `\n\timport { ${svelteImports.join(', ')} } from 'svelte'`)
      return file
    }),
    ...convertFiles('.js', '.js', file => {
      file = convertRequiresToImports(file)
      file = convertImportedHtmlToSvelte(file)
      return file
    })
  ]

  Promise.all(tasks)
    .then(createStores)
    .then(() => console.log('Complete!'))
})

function createStores() {
  const storeKeys = Object.keys(stores)
  console.log(`Creating stores: ${storeKeys}`)
  const storeTasks = storeKeys.map(k => {
    const storeFile = path.join(convertToOutputDir(srcFolder), `stores/${k}.js`)
    const defaultStoreVal = k === 'loading' ?
      'false' : 'null'
    const storeContents = `import { writable } from 'svelte/store'\nexport default writable(${defaultStoreVal})`
    writeFile(storeFile, storeContents)
  })
  return Promise.all(storeTasks)
}

function writeFile(filePath, contents) {
  // make dir if not exists
  return new Promise((res, rej) => {
    fs.mkdir(path.dirname(filePath), { recursive: true }, err => {
      if (err) throw err

      // write file contents to output folder
      return fs.writeFile(filePath, contents, 'utf8', (err) => {
        if (err) throw err
        res()
      })
    })
  })
}

function convertRequiresToImports(file) {
  file = file.replace(/(?:const|let|var)\s([a-zA-Z0-9{},\r\n\s]+)\s?=\s?require\(([^)]+)\).*$/gm, 'import $1 from $2')
  file = file.replace(/\s\sfrom/g, ' from') // get rid of double space next to "from"
  file = file.replace(/require\(([^)]+)\).*$/gm, 'import $1')
  file = file.replace(/module\.exports\s?=\s?/g, 'export default ')
  return file
}

function convertImportedHtmlToSvelte(file) {
  file = file.replace(/^import\s'([^'])'/gm, (substring, path) => `import '${path.replace('.html', '.svelte')}'`)
  file = file.replace(/^import\s([^\s]+)\sfrom '([^']+)'/gm, (substring, importName, path) => `import ${importName} from '${path.replace('.html', '.svelte')}'`)
  return file
}

function convertYieldToSlot(file) {
  // {{yield}} --> <slot></slot>
  file = file.replace(/{{yield}}/g, '<slot></slot>')

  // {{yield title}} --> <slot name="title"></span>
  file = file.replace(/{{yield ([a-zA-Z]+)}}/g, '<slot name="$1"></slot>')

  // TODO: partials...some can be extracted to sub components. but some are actually yield usages
  // if there are no usages in the file, it's a slot, so use <span slot="partialName">...</span>
  // else, extract the partial name to a sub component [basecomponentname][PartialName], import it, update usage names

  return file
}

function convertIfStatements(file) {
  file = file.replace(/{{else}}/g, '{:else}')
  file = file.replace(/{{elseif/g, '{:else if')
  return file
}

function convertEachStatementsHaveAliases(file) {
  // whereever this comment is in the code, we'll need to update the each body to use the alias...
  return file.replace(/{{#each(\s[a-zA-Z]+)}}/g, `{#each $1 as x}\n<!-- ${todoConvert} EACH BODY TO USE ALIAS -->`)
}

function convertRactiveScriptContents(file, filePath) {
  let svelteDef = ''
  try {
    file = file.replace(/component\.exports\s=\s((?:.|[\r\n])+)/m, (str, componentExport) => {
      componentExport = componentExport.replace('</script>', '')
      const component = eval(`(() => {
        return ${componentExport}
      })()`)

      if (component.onrender) {
        svelteImports.push('onMount')
        const arrowFunc = deIndent(toArrowFunc(getValDef(component.onrender.toString(), 'onrender')))
        svelteDef += `\tonMount(${arrowFunc})\n`
      }

      if (component.onteardown) {
        svelteImports.push('onDestroy')
        const arrowFunc = deIndent(toArrowFunc(getValDef(component.onteardown.toString(), 'onteardown')))
        svelteDef += `\tonDestroys(${arrowFunc})\n`
      }

      if (component.ondestruct) {
        svelteImports.push('onDestroy')
        const arrowFunc = deIndent(toArrowFunc(getValDef(component.ondestruct.toString(), 'ondestruct')))
        svelteDef += `\tonDestroy(${arrowFunc})\n`
      }

      if (component.data) {
        // convert all data keys to exported values or global functions
        const dataFuncDef = component.data.toString().replace(/^data\(\)/, '');
        const dataKeys = dataFuncDef.matchAll(/(?:\s)[^a-z0-9]+([a-z0-9]+)(?:(?:[:(])|(?:,$))/gmi);
        for (const m of dataKeys) {
          const key = m[1];
          const valDef = deIndent(getValDef(dataFuncDef, key), 3);
          const keyIsFunc = /^\(/.test(valDef);
          svelteDef += '\t';
          if (keyIsFunc) {
            // data funcs can simply be funcs in global scope
            const keyIsArrayFunc = /^\([^)]*\)\s?=>/.test(valDef);
            if (keyIsArrayFunc) {
              svelteDef += `let ${key} = ${valDef}`;
            }
            else {
              svelteDef += `function ${key} ${valDef}`;
            }
          }
          else {
            svelteDef += `export let ${key} = ${valDef}`;
          }
          svelteDef += '\n';
        }
      }

      if (component.oninit) {
        // oninit into a self-calling function
        const funcBody = getValDef(component.oninit.toString(), 'oninit').replace(/^\(\)\s?{/, '').replace(/\}$/, '');
        svelteDef += `\n\t${deIndent(funcBody, 2)}\n`
      }

      if (component.computed) {
        // convert all computed methods to reactive self-calling functions
        Object.keys(component.computed).forEach(c => {
          const funcDef = component.computed[c].toString()
          const arrowFunc = toArrowFunc(getValDef(funcDef, c))
          svelteDef += `\n\t$: ${c} = (${deIndent(arrowFunc, 2)})()\n`
        });
      }

      // all other keys on the exported component are likely functions that can simply come to the global scope of the component
      component.computed = undefined
      component.onteardown = undefined
      component.oninit = undefined
      component.data = undefined
      component.onrender = undefined
      const functions = Object.keys(component).filter(k => component[k] != null)
      functions.forEach(k => {
        let funcDef = component[k].toString()
        funcDef = funcDef.replace(/^([a-zA-Z0-9]+)\(([^)]*)\)/, '\tfunction $1($2)')
        funcDef = deIndent(funcDef)
        svelteDef += `\n\n${funcDef}`
      })

      // this.findComponent('my-component') --> MyComponent
      svelteDef = svelteDef.replace(/this\.findComponent\('([^']+)'\)/gm, (str, componentName) => {
        return toUpperName(componentName)
      })

      // this.find --> just do manually...not many instances, so not worth time
      svelteDef = svelteDef.replace(/(this\.find[^$]+)/gm, `/* ${todoConvert}: \`bind:this={myEl}\` FOR THIS.FIND */\n$1`)

      return '</script>'
    })
  } catch (e) {
    console.log('Failed to parse component: ', e.toString(), filePath)
  }
  // put the svelte def at the end of the script block
  return file.replace('</script>', `\n${svelteDef}\n</script>`)
}

function convertEventHandlers(file) {
  // on-[event]="@.handler(params)" --> on:[event]={() => handler(params)}
  // on-[event]="eventName" --> on:[event]={eventName}
  // on-[event]="@.handler()" --> on:[event]={handler}
  file = file.replace(/([\s\n]+)on-([a-zA-Z]+)\="([^"]+)"/gm, (str, spaceOrNewLine, eventName, eventHandler) => {
    const noParams = /^([a-zA-Z0-9]+)$/.exec(eventHandler) || /^(?:this|@)\.([a-zA-Z0-9]+)\(\)/.exec(eventHandler)
    const eventHandlerFinal = noParams != null ? noParams[1] : `() => ${eventHandler.replace(/^@\./, "")}`
    const modifier = eventName === 'submit' ? '|preventDefault' : ''
    return `${spaceOrNewLine}on:${eventName}${modifier}={${eventHandlerFinal}}`
  })

  // // convert this.on('event',  statements to simply be named functions
  // file = file.replace(/this\.on\('([^']+)',\s?/, 'function $1')

  return file
}

function convertSharedToStore(file) {
  let storesUsed = {}

  // template usages
  file = file.replace(/@shared\.([a-zA-Z0-9]+)/g, (str, storeKey) => {
    storesUsed[storeKey] = true
    return `$${storeKey}`
  })

  // import the store
  const distinctStores = Object.keys(storesUsed)
  const imports = distinctStores.map(s => `\timport ${s} from 'stores/${s}'`).join('\n')
  file = insertAtBeginningOfScript(file, imports)

  // we write a store file at the end of the program...
  distinctStores.forEach(s => stores[s] = {})

  return file
}

function convertFireToDispatch(file) {
  // this.fire --> dispatch (and import event dispatcher)
  let importEventDispatcher = false
  file = file.replace(/this\.fire\(/g, (str) => {
    importEventDispatcher = true
    return 'dispatch('
  })

  // no need to pass `null` as 2nd param--ractive Object.assigned to the original event, but svelte simply passes what you tell it to pass
  file = file.replace(/(dispatch|pubsub.fire)\(([^,]+), null,([^)]+)\)/g, (str, dispatchOrPubSub, eventName, eventArgs) => {
    return `${dispatchOrPubSub}(${eventName}, ${eventArgs.trim()})`
  })

  if (importEventDispatcher) {
    svelteImports.push('createEventDispatcher')
    file = file.replace('component.exports', `const dispatch = createEventDispatcher()\n\tcomponent.exports`)
  }
  return file
}

function convertGetSet(file) {
  const nullChain = keypath => keypath.replace('.', '?.')
  file = file.replace(/(?:@|this)\.set\('([^']+)',\s?([^)]+)\)/g, (str, keypath, value) => `${keypath} = ${value}`)
  file = file.replace(/(?:@|this)\.get\('([^']+)'\)/g, (str, keypath) => nullChain(keypath))

  // get rid of instances where we have something like const propName = propName--we can simply refer to the prop value directly (most likely)
  file = file.replace(/(const|let)\s([a-z0-9]+)\s=\s([a-z0-9]+)/gi, (str, constOrVar, varName, varVal) => varName === varVal ? '' : str)

  // all occurances of `this.` are unnecessary since svelte just uses the component scope
  file = file.replace(/this\./g, '')

  return file
}

function convertSimpleProps(file) {
  // someprop={someprop} --> {someprop}
  file = file.replace(/([a-z0-9]+)="?{([a-z0-9]+)}"?([$\s])/gim, (str, prop, propValue, spaceOrEndOfLine) => {
    if (prop === propValue)
      return `{${prop}}${spaceOrEndOfLine}`
    return str
  })
  return file
}

function convertToolTipDecorator(file) {
  // we have a tool tip decorator that mostly stays the same
  let importTip = false
  file = file.replace(/as-tip="([^"]+)"/g, (str, tip) => {
    importTip = true
    return `use:tip={${tip}}`
  })
  if (importTip)
    file = insertAtBeginningOfScript(file, `\timport tip from 'decorators/tip'`)
  return file
}

function convertRactiveHelpers(file) {
  // we loaded some services onto the ractive defaults...we need to explicitly import them
  const services = {
    dateService: 'services/date-service',
    stringUtils: 'services/string-utils'
  }
  const serviceFuncs = {
    dateformat: 'dateService',
    datetimestamp: 'dateService',
    datestamp: 'dateService',
    fromnow: 'dateService',
    calendartime: 'dateService',
    weekday: 'dateService',

    splitCamelCaseToSentence: 'stringUtils',
    toFriendlyList: 'stringUtils',
    toRouteSearchTerm: 'stringUtils',
    partialDesc: 'stringUtils'
  }
  const helperFuncs = Object.keys(serviceFuncs)
  const templateUsages = new RegExp(`(?<!\\.)(${helperFuncs.join('|')})\\(`, 'g')
  let servicesToImport = {}
  file = file.replace(templateUsages, (str, method) => {
    const serviceName = serviceFuncs[method]
    servicesToImport[serviceName] = true
    return `${serviceName}.${method}(`
  })
  const notImported = path => {
    const notImported = file.indexOf('\'' + path + '\'') === -1
    return notImported
  }
  let imports = Object.keys(servicesToImport)
    .filter(s => notImported(services[s]))
    .map(s => `import ${s} from '${services[s]}'`)

  // some services simply export a single default function
  const singleMethodServices = {
    validator: 'services/validator',
    humanFileSize: 'services/string-utils',
    readableNumber: 'services/string-utils'
  }
  const singleMethodNames = Object.keys(singleMethodServices)
  const singleMethodUsages = new RegExp(`(${singleMethodNames.join('|')})\()`, 'g')
  let singleMethodImports = {}
  file.replace(singleMethodUsages, (str, method) => singleMethodUsages[method] = true)
  const singleMethodImportsArr = Object.keys(singleMethodImports)
    .filter(m => notImported(singleMethodServices[m]))
    .map(m => `import ${m} from '${singleMethodServices[m]}'`)
  imports = imports.concat(singleMethodImportsArr)

  file = insertAtBeginningOfScript(file, `\t${imports.join('\n\t')}`)

  return file
}

function convertClassProps(file) {
  // "class" is a reserved keyword in js, so rename to "className", like react's jsx does
  file = file.replace(/let class\s=/g, 'let className =')

  // built up a list of svelte components that contain "export let className", so we can update usages accordingly:
  const componentsWithClassNameProp = ["Alert", "Btn", "BtnGroup", "Column", "FormGroup"]
  file = file.replace(
    new RegExp(`<(${componentsWithClassNameProp.join('|')})([a-z\\s\\n\\t]*)class=`, 'g'),
    (str, component, inBetween) => `<${component}${inBetween ? inBetween : ''}className=`
  )

  return file
}

function convertDoubleBracketsToSingle(file) {
  file = file.replace(/{{{/g, '{@html ').replace(/}}}/g, '}')
  file = file.replace(/{{/g, '{').replace(/}}/g, '}')
  return file
}

function convertLinksToImports(file) {
  // we used https://github.com/thomsbg/ractive-component-loader/blob/master/index.js
  // which uses html <link> to import sub-components
  // convert the links into import statements instead
  const getComponentImport = (name, path) => {
    const componentNameCapitalized = toUpperName(name)
    const componentPathCapitalized = path.replace(name, componentNameCapitalized)
    return `\timport ${componentNameCapitalized} from '${componentPathCapitalized}.svelte'`
  }
  const link = /\<link rel\=\"ractive\" name\=\"(.+)\" href\=\"(.+)" \/\>/gmi
  let imports = []
  let components = []
  file = file.replace(link, (substring, componentName, componentPath) => {
    const importStatement = getComponentImport(componentName, componentPath)
    imports.push(importStatement)
    components.push({ name: componentName, replaceWith: toUpperName(componentName) })
    return ''
  })
  // replace usages' capitalization
  components.forEach(c => {
    file = file.replace(new RegExp('(<\/?)' + c.name, 'g'), (str, opening) => {
      return `${opening}${c.replaceWith}`
    })
  })

  // convert all implicit ractive components into import statements too
  const implicitComponents = { "sidebar": "components/sidebar", "main-content": "components/main-content", "help-block": "components/fields/help-block", "help": "components/help", "form-control-static": "components/fields/form-control-static", "input-checkbox": "components/fields/input-checkbox", "input-checkboxgroup": "components/fields/input-checkboxgroup", "input-radiogroup": "components/fields/input-radiogroup", "input-text": "components/fields/input-text", "input-phone": "components/fields/input-phone", "input-email": "components/fields/input-email", "input-number": "components/fields/input-number", "input-textarea": "components/fields/input-textarea", "input-password": "components/fields/input-password", "input-rating": "components/fields/input-rating", "input-select": "components/fields/input-select", "input-toggle": "components/fields/input-toggle", "required-marker": "components/fields/required-marker", "loading": "components/loading", "icon": "components/icon", "tag": "components/tag", "input-tags": "components/fields/input-tags", "alert": "components/bootstrap/alert", "btn": "components/bootstrap/btn", "btn-group": "components/bootstrap/btn-group", "column": "components/bootstrap/column", "form-group": "components/bootstrap/form-group", "row": "components/bootstrap/row", "card": "components/card", "sub-nav": "components/sub-nav", "sub-nav-item": "components/sub-nav-item", "layout-two": "components/layout-two", "tabs": "components/tabs", "tab": "components/tab", "content-switch": "components/content-switch", "content-case": "components/content-case", "content-case-static": "components/content-case-static", "modal": "components/modal", "modal-confirm": "components/modal-confirm", "not-found": "pages/not-found" }
  const implicitComponentNames = Object.keys(implicitComponents)
  const implicitRegex = new RegExp(`(<\/?)(${implicitComponentNames.map(c => `(?:${c})`).join('|')})`, 'g')
  const implicitUsed = {}
  file = file.replace(implicitRegex, (str, bracket, componentName) => {
    if (!implicitUsed[componentName]) {
      implicitUsed[componentName] = true
      const importStatement = getComponentImport(componentName, implicitComponents[componentName])
      imports.push(importStatement)
    }
    return `${bracket}${toUpperName(componentName)}`
  })

  // put all imported components directly after opening script tag
  file = insertAtBeginningOfScript(file, imports.join('\n'))

  return file
}

function toUpperName(word) {
  return word.split('-').map(n => capitalize(n)).join('')
}

function capitalize(word) {
  return word[0].toUpperCase() + word.substring(1)
}

function insertAtBeginningOfScript(file, scriptContent) {
  if (scriptContent.trim() === '')
    return file
  if (/<script>/.test(file))
    file = file.replace('<script>', `<script>\n${scriptContent}`)
  else
    file += `\n\n<script>\n${scriptContent}\n</script>`
  return file
}

/*
   parse out value def that might span multiple lines and be a complex object/array

   getValDef('{ myprop: null }', 'myprop') // 'null'
   getValDef('{ myprop, someotherprop }', 'myprop') // 'myprop'
   getValDef('{ myprop: (some, stuff) => { return [some, stuff]; } }', 'myprop') // '(some, stuff) => { return [some, stuff]; }'
   getValDef('{ myprop(some, stuff) { return [some, stuff]; } }', 'myprop') // '(some, stuff) { return [some, stuff]; }'
   getValDef('{ myprop: [some, stuff] }', 'myprop') // '[some, stuff]'
*/
function getValDef(contextStr, key) {
  let valDefStartMatch = new RegExp(`${key}[,:(]`).exec(contextStr)
  let valDefStart = valDefStartMatch.index + key.length
  if (contextStr[valDefStart] === ',')
    return key
  if (contextStr[valDefStart] === ':')
    valDefStart++

  let arrayBegin = 0
  let objectBegin = 0
  let parenthesisBegin = 0
  let valDef = ''
  for (let i = valDefStart; i < contextStr.length; i++) {
    const char = contextStr[i]
    if (char === '[')
      arrayBegin++
    else if (char === ']')
      arrayBegin--
    else if (char === '{')
      objectBegin++
    else if (char === '}')
      objectBegin--
    else if (char === '(')
      parenthesisBegin++
    else if (char === ')')
      parenthesisBegin--

    const allClosed = arrayBegin === 0 && parenthesisBegin === 0 && objectBegin <= 0
    if (allClosed) {
      if (char === ',') {
        break
      }
      else if (char === '}') {
        if (objectBegin === 0) // could be negative if end of parent object/func
          valDef += char
        break
      }
      else if (char === ']') {
        valDef += char
        break
      }
    }
    valDef += char
  }
  return valDef.trim()
}

function toArrowFunc(objectFunc) {
  return objectFunc.replace(/^\(\)/, '() =>')
}

function deIndent(str, num = 1) {
  for (let i = 0; i < num; i++) {
    str = str.replace(/\n\t/g, '\n')
  }
  return str
}
