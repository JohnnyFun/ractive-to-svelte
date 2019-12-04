# ractive-to-svelte
Converts a bunch of syntax from Ractive 1.2.0 to Svelte 3.16.0

- `computed` properties to reactive statements
- `data()` to `export let` statements
- `onrender` into OnMount, onteardown (and ondestruct...) into OnDestroy
- `oninit` contents to global scope
- other component methods moved to global scope
- `{{{...}}}` to {@html ...}
- `{{` and `}}` to `{` and `}`
-  `@shared` to store
   - `@shared.propName` --> `$propName`
   - then create a file './stores/propName' that exports a writable store
   - and import the store
- component `<link>` to import statements
   - we used `ractive-component-loader` which uses html `<link>` elments to import sub components
- most `on-` event handler forms to valid svelte handlers
   - `on-click="@.myMethod()"` --> `on:click={myMethod}`
   - `on-click="myEvent"` --> `on:click={myEvent}` (assumes you'll convert your `.on` handler to a global function)
   - `on-click="@.myMethod(some, stuff)"` --> `on:click={() => myMethod(some, stuff)}`
   - doesn't handle the one like "`on-click="['eventname'...` we didn't use that syntax much...
- `fire` to `dispatch`
   - it imports `createEventDispatcher` and creates one called `dispatch`
- `{{yield}}` to `<slot />` (handles named yields to named slots too
   - related: might also make it extract non-yield partials into sub-components too, but we don't have a ton of them, so we'll see...
- misc other things...

For some things, it simply adds a todo comment: 
- `each` statement without an alias--svelte requires an alias
- `this.find` -- use bind:this={myEl} 
- `this.findComponent` -- use bind:this={myComponent} and export the function you want to call from the sub component
