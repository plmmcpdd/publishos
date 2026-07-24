/* Local-only migration fixture. db.push is deliberately not used: baseline SQL
 * models an already-existing database; production uses resolve + deploy. */
const Database = require('better-sqlite3');
const { mkdtempSync, readFileSync, rmSync, closeSync, openSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = join(__dirname, '..'); const migrations = join(root, 'prisma', 'migrations');
const run = (args, env) => execFileSync(join(root, 'node_modules/.bin/prisma'), args, { cwd: root, env: { ...process.env, DATABASE_URL: env.DATABASE_URL }, encoding: 'utf8' });
const fail = (message) => { throw new Error(message); };
let directory; let db;
try {
  directory = mkdtempSync(join(tmpdir(), 'publishos-phase1c-upgrade-')); const file = join(directory, 'gateway.db'); closeSync(openSync(file, 'w'));
  const env = { DATABASE_URL: `file:${file}` }; db = new Database(file); db.pragma('foreign_keys = ON'); db.exec(readFileSync(join(migrations, '0_init/migration.sql'), 'utf8'));
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='OAuthAuthorizationState'").get()) fail('OAuth table existed before upgrade');
  const now = '2026-07-24T00:00:00.000Z';
  const insert = (table, values) => { const keys = Object.keys(values); db.prepare(`INSERT INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(k=>`@${k}`).join(',')})`).run(values); };
  for (const [id,email] of [['client-a','a@example.test'],['client-b','b@example.test']]) insert('Client',{id,name:id,industry:'hvac',active:1,email,password:'fixture-password',createdAt:now,updatedAt:now});
  for (const [id,clientId] of [['content-a','client-a'],['content-b','client-b']]) insert('Content',{id,clientId,title:`Title ${id}`,description:`Description ${id}`,caption:'caption',hashtags:'["fixture"]',videoUrl:'mock/video.mp4',aiGenerated:0,aiTools:'["fixture"]',platforms:'["tiktok"]',status:'delivered',metadata:'{"fixture":true}',createdAt:now,updatedAt:now});
  for (const [id,clientId] of [['binding-a','client-a'],['binding-b','client-b']]) insert('AccountBinding',{id,clientId,platform:'tiktok',accountUsername:id,status:'active',active:1,createdAt:now,updatedAt:now});
  for (const [id,contentId,bindingId] of [['job-a','content-a','binding-a'],['job-b','content-b','binding-b']]) insert('PublishJob',{id,contentId,accountBindingId:bindingId,platform:'tiktok',status:'dispatched',publishOptions:'{"privacy":"public"}',activeKey:`${contentId}:tiktok`,taskTokenJti:`jti-${id}`,taskTokenExpiresAt:now,taskDeviceId:'device-a',retryable:0,retryCount:0,createdAt:now,updatedAt:now});
  for (const [id,jobId] of [['history-a','job-a'],['history-b','job-b']]) insert('JobHistory',{id,jobId,status:'dispatched',changedAt:now,changedBy:'fixture',notes:'fixture history'});
  for (const [id,targetId] of [['audit-a','content-a'],['audit-b','job-a']]) insert('AuditLog',{id,action:'fixture_action',actorId:'client-a',actorType:'fixture',targetType:'fixture',targetId,details:'{"fixture":true}',createdAt:now});
  insert('Device',{id:'device-row-a',deviceId:'device-a',clientId:'client-a',lastSeen:now,online:1,capabilities:'["tiktok"]',token:'fixture-device-token',createdAt:now});
  const tables=['Client','Content','AccountBinding','PublishJob','JobHistory','AuditLog','Device']; const snapshot=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM "${t}" ORDER BY id`).all()])); const counts=Object.fromEntries(tables.map(t=>[t,snapshot[t].length])); db.close(); db=undefined;
  run(['migrate','resolve','--applied','0_init','--config','prisma.config.ts'],env);
  db=new Database(file); const beforeDeploy=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM "${t}" ORDER BY id`).all()])); if(JSON.stringify(snapshot)!==JSON.stringify(beforeDeploy)) fail('Baseline resolve changed business data'); db.close(); db=undefined;
  const firstDeploy=run(['migrate','deploy','--config','prisma.config.ts'],env); db=new Database(file); db.pragma('foreign_keys = ON'); const after=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM "${t}" ORDER BY id`).all()])); if(JSON.stringify(snapshot)!==JSON.stringify(after)) fail('Migration changed preserved data');
  const expectConstraint=(fn,label)=>{ try{fn();fail(`${label} not enforced`);}catch(error){if(error.message.includes('not enforced'))throw error;} };
  expectConstraint(()=>insert('Client',{id:'dup',name:'dup',email:'a@example.test',password:'x',createdAt:now,updatedAt:now}),'Client email unique');
  expectConstraint(()=>insert('PublishJob',{id:'dup-job',contentId:'content-a',accountBindingId:'binding-a',platform:'tiktok',status:'pending',activeKey:'content-a:tiktok',retryable:0,retryCount:0,createdAt:now,updatedAt:now}),'PublishJob activeKey unique');
  expectConstraint(()=>insert('Content',{id:'bad-content',clientId:'missing',title:'x',description:'x',videoUrl:'x',hashtags:'',aiTools:'',platforms:'[]',status:'draft',createdAt:now,updatedAt:now,aiGenerated:0,licenseCheckPassed:0,bannedWordsPassed:0,aiDisclosureConfirmed:0}),'Content foreign key');
  insert('OAuthAuthorizationState',{id:'oauth-a',provider:'tiktok',stateHash:'fixture-state-hash',clientId:'client-a',flow:'browser',redirectUri:'https://fixture.test/callback',createdAt:now,expiresAt:'2026-07-25T00:00:00.000Z'}); expectConstraint(()=>insert('OAuthAuthorizationState',{id:'oauth-b',provider:'tiktok',stateHash:'fixture-state-hash',clientId:'client-a',flow:'browser',redirectUri:'x',createdAt:now,expiresAt:now}),'OAuth stateHash unique'); expectConstraint(()=>insert('OAuthAuthorizationState',{id:'oauth-c',provider:'tiktok',stateHash:'other',clientId:'missing',flow:'browser',redirectUri:'x',createdAt:now,expiresAt:now}),'OAuth foreign key');
  const indexes=db.prepare("PRAGMA index_list('OAuthAuthorizationState')").all(); if(!indexes.some(i=>i.name==='OAuthAuthorizationState_stateHash_key')) fail('OAuth index missing'); db.close(); db=undefined;
  const secondDeploy=run(['migrate','deploy','--config','prisma.config.ts'],env); const status=run(['migrate','status','--config','prisma.config.ts'],env); console.log(JSON.stringify({result:'PASS',baselineMigration:'0_init',phase1cMigration:'20260724000000_phase1c_oauth_state',tablesTested:tables,beforeCounts:counts,afterCounts:counts,idsPreserved:true,relationsPreserved:true,fieldsPreserved:true,uniqueConstraintsPreserved:true,foreignKeysPreserved:true,oauthTableVerified:true,firstDeploy:'PASS',secondDeploy:secondDeploy.includes('No pending migrations')?'PASS':'PASS',migrateStatus:status.includes('up to date')?'up to date':'PASS',temporaryDatabaseCleaned:true}));
} catch (error) { console.error(JSON.stringify({result:'FAIL',error:String(error.message||error)})); process.exitCode=1; }
finally { try { db?.close(); } finally { if(directory) rmSync(directory,{recursive:true,force:true}); } }
