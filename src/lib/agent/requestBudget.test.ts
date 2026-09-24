import test from 'node:test';import assert from 'node:assert/strict';import {messageBudget,toolSchemaTokens} from './requestBudget.ts';
test('full request reserves real schemas and output without exceeding model window',()=>{
 const b=messageBudget(128000,60000);assert.ok(b+60000+32000+1024<=128000);
 assert.equal(messageBudget(128000,150000),0);
 let calls=0;const tool={name:'x',description:'test',parameters:{type:'object',properties:{}}} as never;
 const estimate=(text:string)=>{calls++;return text.length;};
 assert.equal(toolSchemaTokens([tool],estimate),toolSchemaTokens([tool],estimate));assert.equal(calls,1);
});
