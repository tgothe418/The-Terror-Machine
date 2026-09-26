module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'prettier', // Ensures ESLint doesn't fight with Prettier
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error', // Flags places where you abandoned TypeScript
  },
  overrides: [
    {
      files: [
        'src/lib/cohortEngine.ts',
        'src/lib/cohortBehaviors.ts',
        'src/lib/submitContract.ts',
        'src/lib/cohortCognition.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: './fearTexture',
                message:
                  'fearTexture is for prompt texture only and must not be imported in mechanical/behavior paths.',
              },
              {
                name: '../lib/fearTexture',
                message:
                  'fearTexture is for prompt texture only and must not be imported in mechanical/behavior paths.',
              },
            ],
            patterns: ['*fearTexture*'],
          },
        ],
      },
    },
    {
      files: ['server/mcp/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '../../src/store/useAppStore',
                message: 'server/mcp must not import production stores.',
              },
              {
                name: '../src/store/useAppStore',
                message: 'server/mcp must not import production stores.',
              },
              {
                name: '@/store/useAppStore',
                message: 'server/mcp must not import production stores.',
              },
              {
                name: 'idb-keyval',
                message: 'server/mcp must not import idb-keyval.',
              },
            ],
            patterns: ['*useAppStore*', '*core/store*', 'idb-keyval*'],
          },
        ],
      },
    },
  ],
}
