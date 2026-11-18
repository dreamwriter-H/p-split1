'use strict';

const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/standalone');

const file = process.argv[2] || path.join(__dirname, '../index.html');
const source = fs.readFileSync(file, 'utf8').match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!source) throw new Error(`Cannot find the application script in ${file}.`);

// JSX compilation alone accepts references to variables declared in another component.
function checkRefBindings({ types }) {
    return {
        visitor: {
            JSXAttribute(attribute) {
                const { name, value } = attribute.node;
                if (!types.isJSXIdentifier(name, { name: 'ref' }) || !types.isJSXExpressionContainer(value)) return;
                const ref = value.expression;
                if (types.isIdentifier(ref) && !attribute.scope.getBinding(ref.name)) {
                    throw attribute.buildCodeFrameError(`JSX ref ${ref.name} is outside its declaration scope.`);
                }
            }
        }
    };
}

try {
    babel.transform(source, { presets: ['react'], plugins: [checkRefBindings], sourceType: 'module', filename: file });
    console.log('Application JSX compiles and its ref bindings are in scope.');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
