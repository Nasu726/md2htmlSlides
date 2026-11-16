#!/usr/bin/env node
import { run } from './index.js';

const result = run(process.argv.slice(2));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
