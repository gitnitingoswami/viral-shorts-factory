// @ts-check
const { defineConfig } = require('eslint/config');
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  { ignores: ['dist/**', '.angular/**', 'coverage/**'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Security (T10/T11): no sanitizer bypasses, no raw HTML sinks, tokens never in web storage.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^bypassSecurityTrust/]',
          message: 'Sanitizer bypasses are forbidden (SECURITY_DESIGN T10).',
        },
        {
          selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
          message: 'Raw HTML sinks are forbidden (SECURITY_DESIGN T10).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Do not persist auth state in web storage (T11).' },
        { name: 'sessionStorage', message: 'Do not persist auth state in web storage (T11).' },
      ],
    },
  },
  {
    // Specs assert that nothing is written to web storage, so they may read it.
    files: ['**/*.spec.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
