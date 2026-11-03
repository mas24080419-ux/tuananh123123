'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const smart = require('../public/smart-search');
const catalog = [
 {id:'1',name:'Phở bò đặc biệt',category:'Món ăn',price:65000,active:true},
 {id:'2',name:'Trà đào cam sả',category:'Đồ uống',price:38000,active:true},
 {id:'3',name:'Cà phê sữa đá',category:'Đồ uống',price:32000,active:false,sku:'CAFE-03'}
];
test('Vietnamese diacritic-insensitive search', () => {
 assert.equal(smart.normalize('Đồ Uống / Cà PHÊ'), 'do uong ca phe');
 assert.deepEqual(smart.searchItems(catalog,'pho bo').map(x=>x.id),['1']);
 assert.deepEqual(smart.searchItems(catalog,'tra dao').map(x=>x.id),['2']);
 assert.deepEqual(smart.searchItems(catalog,'ca phe sua').map(x=>x.id),['3']);
});
test('searches live catalogue including category and SKU, no fallback fake product', () => {
 assert.deepEqual(smart.searchItems(catalog,'cafe-03').map(x=>x.id),['3']);
 assert.equal(smart.searchItems(catalog,'do uong').length,2);
 assert.deepEqual(smart.searchItems(catalog,'watch'),[]);
 assert.deepEqual(smart.searchItems(catalog,''),catalog);
});
test('tokens must all match and search does not modify live source', () => {
 assert.deepEqual(smart.searchItems(catalog,'bo cam'),[]);
 assert.equal(smart.matches(catalog[0],'PHO'),true);
 assert.equal(smart.matches(catalog[1],'thit'),false);
 assert.equal(catalog[0].name,'Phở bò đặc biệt');
});
