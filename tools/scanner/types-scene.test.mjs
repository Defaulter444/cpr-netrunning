import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, iconPath } from "../../scripts/scanner/constants.js";
import { accessPointTypes, validateTypes, typeInfo } from "../../scripts/scanner/types.js";
import { ensureTemplates } from "../../scripts/scanner/templates.js";
import { saveAP, colorFor, saveUnassignedColor } from "../../scripts/scanner/actions.js";
import { apData, freshAP } from "../../scripts/scanner/model.js";
import { environment, makeScene, makeToken } from "./helpers.mjs";

test("custom AP types provision templates and remain valid when placed", async () => {
  const {values}=environment();
  const entries=accessPointTypes(); entries.push({id:"sensor",label:"Motion Sensor",img:iconPath("generic"),enabled:true});
  values.set("apTypes",{entries:validateTypes(entries)});
  await ensureTemplates();
  const actor=game.actors.find(actor=>actor.flags[MODULE_ID].templateType==="sensor");
  assert.equal(actor.prototypeToken.flags[MODULE_ID].type,"sensor");
  assert.equal(freshAP("sensor").type,"sensor");
  const ap=makeToken(makeScene());
  await saveAP(ap,{name:"Hall Sensor",type:"sensor",netarch:""});
  assert.equal(apData(ap).type,"sensor"); assert.equal(ap.texture.src,iconPath("generic"));
});

test("disabled types retain existing APs but cannot be newly assigned", async () => {
  const {values}=environment(); const entries=accessPointTypes();
  entries.find(type=>type.id==="computer").enabled=false;
  values.set("apTypes",{entries});
  assert.equal(accessPointTypes().some(type=>type.id==="computer"),false);
  assert.equal(typeInfo("computer").label,"Компьютер");
  const ap=makeToken(makeScene());
  await saveAP(ap,{name:"Existing computer",type:"computer",netarch:""});
  await saveAP(ap,{name:"Now generic",type:"generic",netarch:""});
  await assert.rejects(saveAP(ap,{name:"No",type:"computer",netarch:""}),/тип точки доступа из списка/);
});

test("type validation rejects duplicate names and disabling the entire list", () => {
  environment(); const entries=accessPointTypes();
  assert.throws(()=>validateTypes(entries.map(type=>({...type,enabled:false}))),/хотя бы один/);
  entries[1].label=entries[0].label;
  assert.throws(()=>validateTypes(entries),/уникальное название/);
});

test("Unassigned color is scene-specific and assigned Architecture colors take precedence", async () => {
  const {values}=environment(); const a=makeScene("a"), b=makeScene("b");
  for (const scene of [a,b]) scene.setFlag=async(scope,key,value)=>{scene.flags={...scene.flags,[scope]:{...scene.flags?.[scope],[key]:value}};};
  await saveUnassignedColor(a,"#ff0000"); await saveUnassignedColor(b,"#00ff00");
  assert.equal(colorFor("",a),"#ff0000"); assert.equal(colorFor("",b),"#00ff00");
  values.set("netarchColors",{entries:[{uuid:"Item.net",color:"#123456"}]});
  assert.equal(colorFor("Item.net",a),"#123456"); assert.equal(colorFor("Item.net",b),"#123456");
  await assert.rejects(saveUnassignedColor(a,"bad"),/цвет в палитре/);
  assert.equal(colorFor("",a),"#ff0000");
  game.user=game.users.get("player");
  await assert.rejects(saveUnassignedColor(a,"#ffffff"),/только мастер/);
});

test("unset Unassigned colors default to pure red without replacing saved scene colors", () => {
  environment(); const scene=makeScene();
  assert.equal(colorFor("",scene),"#ff0000");
  scene.flags={[MODULE_ID]:{unassignedColor:"#b9c5d2"}};
  assert.equal(colorFor("",scene),"#b9c5d2");
});
