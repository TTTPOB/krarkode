import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const ignores = ['.pixi/**', 'dist/**', 'node_modules/**', 'repo_ref/**', 'ark-sidecar/target/**'];
const nodeGlobals = globals.node;
const browserGlobals = globals.browser;
const mochaGlobals = globals.mocha;

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.ts'],
        ignores: ['src/html/**'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: nodeGlobals,
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-var-requires': 'off',
            'no-undef': 'off',
        },
    },
    {
        files: ['src/test/**/*.ts'],
        languageOptions: {
            globals: {
                ...nodeGlobals,
                ...mochaGlobals,
            },
        },
    },
    {
        files: ['src/html/**/*.ts', 'html/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: browserGlobals,
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-var-requires': 'off',
            'no-undef': 'off',
        },
    },
    ...svelte.configs['flat/recommended'],
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                parser: tsParser,
                extraFileExtensions: ['.svelte'],
            },
            globals: browserGlobals,
        },
        rules: {
            'no-undef': 'off',
            'no-unused-vars': 'off',
        },
    },
    prettier,
    {
        ignores,
    },
];
