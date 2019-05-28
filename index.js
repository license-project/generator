#!/usr/bin/env node

const process = require('process');
process.on('unhandledRejection', e => {
    console.error(e);
    process.exit(1);
})

const { promisify } = require('util');
const { readFile, readFileSync, mkdir, writeFile } = require('fs');
const readFileAsync = promisify(readFile);
const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);
const { join } = require('path');
const inquirer = require('inquirer');
const spdxLicenseIds = require('spdx-license-ids');
const babel = require('@babel/core');
const Git = require("nodegit");

// Bootstrapping
let cc0;
try {
    cc0 = require('@license-project/CC0-1.0');
} catch (e) {
    cc0 = {
        text: readFileSync(__dirname + '/cc0.txt').toString('utf-8'),
    };
}

(async function main() {
    if (process.argv.length != 3) {
        console.error('You must specify a license file name.');
        return 1;
    }

    const licenseText = await readFileAsync(process.argv[2]).toString('utf-8');

    const gitConfig = await Git.Config.openDefault();
    const gitName = await gitConfig.getString('user.name');
    const gitEmail = await gitConfig.getString('user.email');

    const answers = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'spdx',
            message: 'Is this license listed by SPDX?',
            default: true,
        },
        {
            type: 'input',
            name: 'name',
            message: 'What is this license\'s SPDX identifier?',
            when: answers => answers.spdx,
            validate: answer => spdxLicenseIds.includes(answer) || 'That is not a valid SPDX identifier.',
        },
        {
            type: 'input',
            name: 'shortName',
            message: 'What is a short version of this license\'s name? (e.g. GPL, BlueOak, CC-BY)',
            when: answers => !answers.spdx,
            validate: answer => !/\s/g.test(answer) || 'The name cannot contain whitespace',
        },
        {
            type: 'input',
            name: 'longName',
            message: 'What is a long version of this license\'s name? (Usable as a package description)',
            validate: answer => answer !== '',
        },
        {
            type: 'input',
            name: 'version',
            message: 'What is this license\'s version? (e.g. 2.0 for GPL-2.0, 1.0.0 for BlueOak-1.0.0, empty for ISC)',
            when: answers => !answers.spdx,
            validate: answer => !/\s/g.test(answer) || 'The version cannot contain whitespace',
        },
        {
            type: 'input',
            name: 'authorName',
            message: 'What is your name?',
            default: gitName,
            validate: answer => answer !== '',
        },
        {
            type: 'input',
            name: 'authorEmail',
            message: 'What is your email address?',
            default: gitEmail,
            validate: answer => answer !== '',
        },
        {
            type: 'confirm',
            name: 'license',
            message: 'Do you agree to license this package under the CC0 license?',
            validate: answer => answer || 'You must agree to license this package under the CC0 license to participate in the License Project.',
        },
    ]);

    if (!answers.spdx) {
        answers.name = answers.shortName + '-' + answers.version;
    }

    const package = {
        name: '@license-project/' + answers.name,
        version: '1.0.0',
        description: answers.longName,
        keywords: [
            'license-project',
            'license',
            answers.spdx ? 'spdx' : null,
            answers.name,
        ].filter(x => x != null),
        license: 'CC0-1.0',
        author: {
            name: answers.authorName,
            email: answers.authorEmail,
        },
        esnext: 'index.mjs',
        main: 'index.js',
        repository: {
            type: 'git',
            url: 'https://github.com/license-project/' + answers.name,
        },
    };

    const index = `

    /*
     * The ${answers.name} package from The License Project
     *
     * To the extent possible under law, the person who associated CC0 with
     * this package from The License Project has waived all copyright and
     * related or neighboring rights to this package from The License Project.
     * 
     * You should have received a copy of the CC0 legalcode along with this
     * work. If not, see <http://creativecommons.org/publicdomain/zero/1.0/>.
     */

    export const name = ${JSON.stringify(answers.name)};
    export const text = ${JSON.stringify(licenseText)};

    `;

    const es5Index = await babel.transformAsync(index, {
        cwd: __dirname,
        filename: 'index.js',
        presets: [
            '@babel/preset-env'
        ],
    });

    await mkdirAsync(answers.name);
    await writeFileAsync(join(answers.name, 'package.json'), JSON.stringify(package, null, 4));
    await writeFileAsync(join(answers.name, 'index.mjs'), index);
    await writeFileAsync(join(answers.name, 'index.js'), es5Index);
    await writeFileAsync(join(answers.name, 'LICENSE'), cc0.text);

    const gitPath = join(process.cwd(), answers.name);
    const gitRepo = await Git.Repository.init(gitPath, 0);
    const gitIndex = await gitRepo.refreshIndex();
    await gitIndex.addByPath('package.json');
    await gitIndex.addByPath('index.mjs');
    await gitIndex.addByPath('index.js');
    await gitIndex.addByPath('LICENSE');
    await gitIndex.write();
    const oid = await gitIndex.writeTree();
    const author = Git.Signature.now(answers.authorName, answers.authorEmail);
    await gitRepo.createCommit('HEAD', author, author, 'Initial commit (by @license-project/generator)', oid, []);

    await Git.Remote.create(gitRepo, 'origin', 'git@github.com:license-project/' + answers.name + '.git');
})().then(result => process.exit(result || 0));