/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'tooling-no-eslint-plugin',
      severity: 'error',
      comment:
        'vouchington-tooling must not depend on eslint-plugin-vouchington. The plugin is a separate published package.',
      from: { path: '^packages/vouchington-tooling' },
      to: { path: '^packages/eslint-plugin-vouchington' },
    },
    {
      name: 'eslint-plugin-no-tooling',
      severity: 'error',
      comment:
        'eslint-plugin-vouchington must not depend on vouchington-tooling. Keep the plugin installable without the CLI.',
      from: { path: '^packages/eslint-plugin-vouchington' },
      to: { path: '^packages/vouchington-tooling' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules hard to reason about and test in isolation.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
