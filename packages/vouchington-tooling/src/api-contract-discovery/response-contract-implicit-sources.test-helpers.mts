export const responseContractImplicitSources = {
  'called-helper': `
    declare const app: any
    async function handleCreate(ctx: any) {
      ctx.setStatus(201)
      return { id: 'one' as string }
    }
    app.route('/api/v1/items').post(async (ctx: any) => {
      ctx.json(await handleCreate(ctx))
    })
  `,
  'shared-helper': `
    declare const app: any
    function markCreated(ctx: any) { ctx.setStatus(201) }
    app.route('/api/v1/items').post((ctx: any) => {
      markCreated(ctx)
      ctx.json({ id: 'one' as string })
    })
    app.route('/api/v1/widgets').post((ctx: any) => {
      markCreated(ctx)
      ctx.json({ id: 'one' as string })
    })
  `,
  empty: `
    declare const app: any
    app.route('/api/v1/items/:id').delete((ctx: any) => {
      ctx.setStatus(200)
      ctx.response.empty()
    })
  `,
  'error-guard': `
    declare const app: any
    app.route('/api/v1/auth/me').get((ctx: any) => {
      if (!ctx.user) {
        ctx.setStatus(401)
        return ctx.json({ error: 'not authenticated' as string })
      }
      ctx.json({ user: { id: 'one' as string } })
    })
  `,
  'two-guards': `
    declare const app: any
    app.route('/api/v1/items/:id').get((ctx: any) => {
      if (!ctx.user) {
        ctx.setStatus(401)
        return ctx.json({ error: 'not authenticated' as string })
      }
      if (!ctx.item) {
        ctx.setStatus(404)
        return ctx.json({ error: 'not found' as string })
      }
      ctx.json({ item: { id: 'one' as string } })
    })
  `,
  conflict: `
    declare const app: any
    const sendConflict = (ctx: any, existing: any) => {
      ctx.setStatus(409)
      if (!existing) {
        ctx.json({ error: 'conflict' as string })
        return
      }
      ctx.json({ error: 'conflict' as string, id: 'x' as string })
    }
    app.route('/api/v1/items').post((ctx: any) => {
      const conflict: any = {}
      if (conflict.existing !== undefined) {
        sendConflict(ctx, conflict.existing)
        return
      }
      ctx.setStatus(201)
      ctx.json({ id: 'one' as string, status: 'pending' as string })
    })
  `,
  ternary: `
    declare const app: any
    declare const created: boolean
    app.route('/api/v1/items').post((ctx: any) => {
      ctx.setStatus(created ? 201 : 200)
      ctx.json({ id: 'one' as string })
    })
  `,
  variants: `
    declare const app: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    app.route('/api/v1/items').post((ctx: any) => {
      ctx.setStatus(422)
      apiResponse('POST:/api/v1/items#validation', { error: 'invalid' as string })
      ctx.setStatus(201)
      apiResponse('POST:/api/v1/items', { id: 'one' as string })
    })
  `,
  branches: `
    declare const app: any
    app.route('/api/v1/webhooks/:id').post((ctx: any) => {
      if (ctx.body.event === 'known') {
        ctx.json({ received: true as boolean })
        return
      }
      ctx.json({ ignored: true as boolean })
    })
  `,
  'secondary-failure': `
    declare const app: any
    declare function riskyLookup(): any
    app.route('/api/v1/jobs/:id').get((ctx: any) => {
      if (ctx.query.mode === 'basic') {
        ctx.json({ ready: true as boolean })
        return
      }
      ctx.json({ value: riskyLookup() })
    })
  `,
  'empty-then-buffer': `
    declare const app: any
    declare const body: any
    declare const contentType: string
    app.route('/api/v1/mcp').post((ctx: any) => {
      if (body.byteLength === 0) {
        ctx.response.empty()
      } else {
        ctx.response.buffer(body, contentType)
      }
    })
  `,
  'buffer-then-empty': `
    declare const app: any
    declare const body: any
    declare const contentType: string
    app.route('/api/v1/mcp').post((ctx: any) => {
      if (body.byteLength > 0) {
        ctx.response.buffer(body, contentType)
      } else {
        ctx.response.empty()
      }
    })
  `,
  'single-failure': `
    declare const app: any
    declare function riskyLookup(): any
    app.route('/api/v1/jobs/:id').get((ctx: any) => {
      ctx.json({ value: riskyLookup() })
    })
  `,
} as const
