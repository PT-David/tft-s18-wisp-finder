import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateB3 } from './data/lib/c4.2b3-required-fields';
const root=resolve(import.meta.dirname,'..'),read=(p:string)=>readFile(resolve(root,p),'utf8');
const [f,d,bf,bd]=await Promise.all([read('data/reviews/18.1/c4.2b3-required-field-evidence.json'),read('data/reviews/18.1/c4.2b3-required-field-decisions.json'),read('data/reviews/18.1/c4.2b2-field-evidence.json'),read('data/reviews/18.1/c4.2b-field-decisions.json')]);
const errors=validateB3(JSON.parse(f),JSON.parse(d),bf,bd);if(errors.length)throw new Error(`C4.2B3 validation failed:\n- ${errors.join('\n- ')}`);console.log('Validated 6 targeted C4.2B3 amendments and composed readiness inputs.');
