import { ID } from "./store.js";
import { activeNetRole, equippedDeck } from "./runner-profile.js";

let cached = null;
async function deps() {
  if (cached) return cached;
  const [rolls, mods, utils, chat] = await Promise.all([
    import("../../../../systems/cyberpunk-red-core/modules/rolls/cpr-rolls.js"),
    import("../../../../systems/cyberpunk-red-core/modules/rolls/cpr-modifiers.js"),
    import("../../../../systems/cyberpunk-red-core/modules/utils/cpr-systemUtils.js"),
    import("../../../../systems/cyberpunk-red-core/modules/chat/cpr-chat.js")
  ]);
  cached = { CPRRolls:rolls, CPRMod:mods.default ?? mods, SystemUtils:utils.default ?? utils, CPRChat:chat.default };
  return cached;
}

function clickEvent(event){ return event ?? { type:"click", ctrlKey:false, metaKey:false }; }

async function post(actor, deck, roll, grantToken="") {
  roll.entityData={actor:actor.id,item:deck.id};
  const {CPRChat}=await deps();
  if(!grantToken){await CPRChat.RenderRollCard(roll);return null;}
  const data=CPRChat.ChatDataSetup(await renderTemplate(roll.rollCard,roll));
  data.speaker=ChatMessage.getSpeaker({actor});
  data.flags={...(data.flags||{}),[ID]:{playerRoll:{token:grantToken,actorUuid:actor.uuid,total:Number(roll.resultTotal??0)}}};
  return (await ChatMessage.create(data))?.id||null;
}

/* Exact plain Interface Check for Going Quiet.
 * No Scanner/Cloak/Pathfinder bucket is applied: only Role, all-actions and
 * wound-state modifiers are relevant to an untyped Interface Check.
 */
export async function rollPlainInterfaceV03(actor,event=null,{grantToken=""}={}){
  const deck=equippedDeck(actor),role=activeNetRole(actor);
  if(!deck||!role)throw new Error("Runner needs an active NET Role and equipped Cyberdeck.");
  try{
    const {CPRRolls,CPRMod,SystemUtils}=await deps();
    if(typeof CPRRolls.CPRInterfaceRoll!=="function")throw new Error("CPRInterfaceRoll missing");
    const roleName=role.system.mainRoleAbility,roleValue=Number.parseInt(role.system.rank,10);
    const roll=new CPRRolls.CPRInterfaceRoll("action",roleName,roleValue);
    roll.ability="interface";roll.rollTitle="Interface";roll.rollCardExtraArgs||={};roll.rollCardExtraArgs.cyberdeck=deck;
    const effects=Array.from(actor.allApplicableEffects?.()??[]),all=CPRMod.getAllModifiers(effects);
    const filtered=all.filter((m)=>!m.isSituational||(m.isSituational&&m.onByDefault));
    roll.addMod(CPRMod.getRelevantMods(filtered,SystemUtils.slugify(roleName)));
    roll.addMod(CPRMod.getRelevantMods(filtered,["allActions","allActionsSpeech","allActionsHands"]));
    roll.addMod([{value:actor.getWoundStateMods?.()??0,source:game.i18n.localize("CPR.rolls.modifiers.sources.woundStatePenalty")}]);
    if(!(await roll.handleRollDialog(clickEvent(event),actor,deck)))return null;
    await roll.roll();
    const messageId=await post(actor,deck,roll,grantToken);
    return {total:Number(roll.resultTotal??0),die:Number(roll.initialRoll??0),criticalSuccess:!!roll.wasCritSuccess?.(),criticalFailure:!!roll.wasCritFail?.(),messageId,roll};
  }catch(error){
    console.error(`${ID} | plain Interface bridge unavailable`,error);
    throw new Error("Plain Interface Check cannot be resolved safely by this CPR build. Scanner will not be substituted; adjudicate this check manually.");
  }
}
