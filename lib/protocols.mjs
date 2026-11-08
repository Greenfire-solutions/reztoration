// Protocol 2 in code: the one place the sacred filter lives. Harvesters apply it
// when they collect, and the library applies it again when it loads, so tightening
// this list takes effect on everything already gathered without a re-harvest.
// Over-blocking is the safe direction.
export const SACRED = /\b(sacred|ceremon\w*|ritual\w*|sun ?dance|ghost dance|medicine (bundles?|bags?|pouch(es)?|wheels?)|sacred bundles?|bundles?|sweat ?lodges?|vision quest|burials?|graves?|funer\w*|mortuary|human remains|skulls?|skeletons?|scalps?|crania|cranium|bones of|kachinas?|katsinam?|katcinas?|false face|masks?|peyote|initiation|puberty (rite|ceremon\w*)|secret society|midewiwin|shaman\w*|witchcraft|sorcery|repatriat\w*|exhum\w*|effigy|altars?|headdress(es)?|war ?bonnets?|eagle feathers?|eagle plumes?|pipes?|pipe ?bags?|pipe ?bowls?|pipe ?stems?|calumet)\b/i;
export const TK_CLOSED = /(secret|sacred|community use only|seasonal|women restricted|men restricted|culturally sensitive)/i;

export function isSacred(...texts) {
  return texts.flat().filter(Boolean).some((t) => SACRED.test(String(t)));
}
export function tkClosed(labels = []) {
  return (labels || []).some((l) => TK_CLOSED.test(String(l)));
}
export const itemBlocked = (it) => isSacred(it.title, it.summary, it.medium) || tkClosed(it.tkLabels);

// Plant uses: ceremonial, witchcraft and similar categories are left out (protocol 2).
const PLANT_RESTRICTED = /ceremon|witchcraft|sacred|love medicine|hunting medicine|gambling|protection|magic|sweat/i;
export const plantUseBlocked = (u) => PLANT_RESTRICTED.test(`${u.use} ${u.subUse}`) || isSacred(u.note);
