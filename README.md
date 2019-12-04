# ractive-to-svelte
converts a bunch of syntax from ractive Ractive 1.2.0 to Svelte 3.16.0

- `computed` properties to reactive statements
- `data()` to `export let` statements
- onrender into OnMount, onteardown (and ondestruct...) into OnDestroy
- oninit contents to global scope

- other methods moved to global scope
- `{{{...}}}` to {@html ...}
-  `@shared` to store
  - `@shared.propName` --> $propName
  - create a file './stores/propName' that exports a writable store
  - import the store
- component <link> to import statements (we used `ractive-component-loader`)
- most on- event handler forms to valid svelte handlers
  - "on-click="@.myMethod()" --> "on:click={myMethod}"
  - "on-click="myEvent" --> "on:click={myEvent}" (assumes you'll convert your `.on` handler to a global function)
   - "on-click="@.myMethod(some, stuff)" --> "on:click={() => myMethod(some, stuff)}"
   - doesn't handle the one like "on-click="['eventname'...we didn't use that syntax much...
- fire to dispatch
- yield to slot
  - might also make it extract non-yielded partials into sub-components too, but we don't have a ton of them, so we'll see...
- misc other things...

For some things, it simply adds a todo comment: 
- `each` statement without an alias--svelte requires an alias
- this.find -- use bind:this={myEl} 
- this.findComponent -- use bind:this={myComponent} and export the function you want to call from the component
