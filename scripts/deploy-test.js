#!/usr/bin/env node

/**
 * Deployment Test Script
 * Verifies that all components are working before Vercel deployment
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Chemistry Calculation Validator - Deployment Test\n');

// Test 1: Check required files
console.log('1️⃣  Checking required files...');
const requiredFiles = [
    'vercel.json',
    '.vercelignore', 
    'server.js',
    'package.json',
    'public/index.html',
    'public/app.js',
    'public/styles.css'
];

let filesOk = true;
requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`   ✅ ${file}`);
    } else {
        console.log(`   ❌ ${file} - MISSING`);
        filesOk = false;
    }
});

// Test 2: Check environment variables
console.log('\n2️⃣  Checking environment variables...');
require('dotenv').config();

const requiredEnvVars = [
    'ANTHROPIC_KEY',
    'MONGO_DB_USERNAME', 
    'MONGO_DB_PASSWORD'
];

let envOk = true;
requiredEnvVars.forEach(envVar => {
    if (process.env[envVar]) {
        console.log(`   ✅ ${envVar} - Set`);
    } else {
        console.log(`   ❌ ${envVar} - NOT SET`);
        envOk = false;
    }
});

// Test 3: Check package.json configuration
console.log('\n3️⃣  Checking package.json...');
const packageJson = require('../package.json');

const checks = [
    { name: 'Name', value: packageJson.name, expected: 'chemistry-calculation-validator' },
    { name: 'Main entry', value: packageJson.main, expected: 'server.js' },
    { name: 'Node engine', value: packageJson.engines?.node, expected: '>=14.x' },
    { name: 'Start script', value: packageJson.scripts?.start, expected: 'node server.js' }
];

let packageOk = true;
checks.forEach(check => {
    if (check.value === check.expected) {
        console.log(`   ✅ ${check.name}: ${check.value}`);
    } else {
        console.log(`   ⚠️  ${check.name}: ${check.value} (expected: ${check.expected})`);
        packageOk = false;
    }
});

// Test 4: Check vercel.json configuration
console.log('\n4️⃣  Checking vercel.json...');
let vercelOk = true;
try {
    const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    
    const vercelChecks = [
        { name: 'Version', value: vercelConfig.version, expected: 2 },
        { name: 'Build source', value: vercelConfig.builds?.[0]?.src, expected: 'server.js' },
        { name: 'Build runtime', value: vercelConfig.builds?.[0]?.use, expected: '@vercel/node' },
        { name: 'Route destination', value: vercelConfig.routes?.[0]?.dest, expected: '/server.js' }
    ];
    
    vercelChecks.forEach(check => {
        if (check.value === check.expected) {
            console.log(`   ✅ ${check.name}: ${check.value}`);
        } else {
            console.log(`   ❌ ${check.name}: ${check.value} (expected: ${check.expected})`);
            vercelOk = false;
        }
    });
} catch (error) {
    console.log(`   ❌ Invalid vercel.json: ${error.message}`);
    vercelOk = false;
}

// Test 5: Check dependencies
console.log('\n5️⃣  Checking dependencies...');
const criticalDeps = [
    'express',
    'mongodb', 
    '@anthropic-ai/sdk',
    'officegen',
    'validator'
];

let depsOk = true;
criticalDeps.forEach(dep => {
    if (packageJson.dependencies[dep]) {
        console.log(`   ✅ ${dep}: ${packageJson.dependencies[dep]}`);
    } else {
        console.log(`   ❌ ${dep} - MISSING`);
        depsOk = false;
    }
});

// Final Results
console.log('\n📊 Test Results:');
console.log('==================');

const results = [
    { name: 'Required Files', status: filesOk },
    { name: 'Environment Variables', status: envOk },
    { name: 'Package Configuration', status: packageOk },
    { name: 'Vercel Configuration', status: vercelOk },
    { name: 'Dependencies', status: depsOk }
];

let allPassed = true;
results.forEach(result => {
    const status = result.status ? '✅ PASS' : '❌ FAIL';
    console.log(`${result.name}: ${status}`);
    if (!result.status) allPassed = false;
});

console.log('\n' + '='.repeat(40));

if (allPassed) {
    console.log('🎉 All tests passed! Ready for Vercel deployment.');
    console.log('\nNext steps:');
    console.log('1. Commit all changes to Git');
    console.log('2. Push to your GitHub repository'); 
    console.log('3. Deploy to Vercel using the DEPLOYMENT.md guide');
    console.log('4. Set environment variables in Vercel dashboard');
    console.log('5. Test your live deployment');
} else {
    console.log('❌ Some tests failed. Please fix the issues above before deploying.');
    console.log('\nCheck the DEPLOYMENT.md guide for detailed instructions.');
}

console.log('\n📖 For detailed deployment instructions, see DEPLOYMENT.md');
process.exit(allPassed ? 0 : 1); 