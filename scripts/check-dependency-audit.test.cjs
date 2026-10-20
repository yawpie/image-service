/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CI checks execute as CommonJS. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { checkAudit } = require('./check-dependency-audit.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const now = new Date('2026-10-19T19:00:00Z');
const db = { Version: 2, UpdatedAt: '2026-10-19T07:00:00Z', NextUpdate: '2026-10-20T07:00:00Z', DownloadedAt: '2026-10-19T14:00:00Z' };
const lock = '{\n"lockfileVersion":3,"packages":{"":{"dependencies":{"example":"1.0.0"}}}\n}';
const packages = [{ Name:'example',Version:'1.0.0' }];
const finding = { VulnerabilityID:'CVE-2026-12345',PkgName:'example',InstalledVersion:'1.0.0',Severity:'HIGH' };
const result = { Target:'package-lock.json',Class:'lang-pkgs',Type:'npm',Packages:packages,Vulnerabilities:[finding] };
const report = { SchemaVersion:2,Trivy:{Version:'0.76.0'},ArtifactType:'filesystem',CreatedAt:'2026-10-19T18:00:00Z',Results:[result] };
const baseline = { packageCount:1,inventorySha256:hash(JSON.stringify(['example@1.0.0'])),findings:[{id:'CVE-2026-12345',name:'example',version:'1.0.0',severity:'HIGH',fixed:''}] };
const policy = { reviewedAt:'2026-10-19',expiresAt:'2026-11-02',owner:'Repository maintainers',triage:'docs/security/dependency-triage.md',lockSha256:hash(lock),full:baseline,production:{...baseline,findings:[]} };
test('allows only scoped, dated findings on the exact canonical lock and package inventory',()=>assert.equal(checkAudit(report,policy,'full',db,lock,now),1));
test('rejects new or severity/version/fix changes without triage',()=>{
  for(const changed of [{...finding,VulnerabilityID:'CVE-2026-54321'},{...finding,Severity:'CRITICAL'},{...finding,InstalledVersion:'2.0.0'},{...finding,FixedVersion:'1.0.1'}]) assert.throws(()=>checkAudit({...report,Results:[{...result,Vulnerabilities:[changed]}]},policy,'full',db,lock,now));
});
test('production never inherits full-only exceptions',()=>assert.throws(()=>checkAudit(report,policy,'production',db,lock,now)));
test('rejects empty scans, wrong targets and incomplete package inventory',()=>{
  for(const bad of [{...report,Results:[]},{...report,Results:[{...result,Target:'other-lock.json'}]},{...report,Results:[{...result,Packages:[]}]},{...report,Results:[{...result,Packages:[...packages,{Name:'unexpected',Version:'1'}]}]}]) assert.throws(()=>checkAudit(bad,policy,'full',db,lock,now));
});
test('fails closed on malformed/error/schema reports and changed lock bytes',()=>{
  for(const bad of [{},{error:'network'},{...report,SchemaVersion:1},{...report,Trivy:{Version:'other'}},{...report,Results:[{...result,Vulnerabilities:{}}]}]) assert.throws(()=>checkAudit(bad,policy,'full',db,lock,now));
  assert.throws(()=>checkAudit(report,policy,'full',db,lock+'\n',now));
});
test('requires fresh successful DB download and rejects stale/future metadata',()=>{
  for(const bad of [{},{...db,Version:1},{...db,UpdatedAt:'2026-10-17T07:00:00Z'},{...db,NextUpdate:'2026-10-19T18:00:00Z'},{...db,DownloadedAt:'2026-10-20T00:00:00Z'}]) assert.throws(()=>checkAudit(report,policy,'full',bad,lock,now));
});
test('rejects expired policy and stale/replayed report dates',()=>{
  assert.throws(()=>checkAudit(report,policy,'full',db,lock,new Date('2026-11-04')));
  assert.throws(()=>checkAudit({...report,CreatedAt:'2026-10-18T18:00:00Z'},policy,'full',db,lock,now));
});
test('accepts zero current-feed findings only with the complete checked package graph',()=>assert.equal(checkAudit({...report,Results:[{...result,Vulnerabilities:[]}]},policy,'full',db,lock,now),0));
test('accepts Windows CRLF only when canonical LF lock content is identical',()=>assert.equal(checkAudit(report,policy,'full',db,lock.replace(/\n/g,'\r\n'),now),1));
