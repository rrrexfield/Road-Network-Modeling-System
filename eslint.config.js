import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'data/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gisalgo/*/src/**'],
              message: '跨包只允许从包主入口(@gisalgo/xxx)导入,禁止深引用。',
            },
          ],
        },
      ],
    },
  },
);
