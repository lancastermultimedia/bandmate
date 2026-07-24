---
name: feedback_supabase_promise
description: Supabase JS SDK on this project does not return standard Promises from query methods — .catch() chaining fails
metadata:
  type: feedback
---

The Supabase JS SDK version used in this project does NOT return standard Promises from query builder methods like `.insert()`, `.select()`, etc. Calling `.catch()` directly on the result throws "TypeError: .catch is not a function."

**Why:** The SDK wraps results in a custom PromiseLike/thenable object, not a native Promise. `.then()` works but `.catch()` may not depending on the context.

**How to apply:** Never use `.catch()` chaining on Supabase query results. For fire-and-forget inserts/updates, always use the async IIFE pattern:
```js
(async () => { try { await sb.from('table').insert({...}); } catch (_) {} })();
```
For awaited queries, use standard try/catch around the await:
```js
try {
  const { data, error } = await sb.from('table').select('...');
} catch (err) { ... }
```

This bit us on `epk_view_logs` insert in `epk.js` — only manifested for anonymous users (incognito) since authenticated users took a different code path.
