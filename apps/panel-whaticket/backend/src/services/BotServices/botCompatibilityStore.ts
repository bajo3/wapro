import Setting from "../../models/Setting";

const BOT_SETTINGS_KEY = "BOT_INTELLIGENCE_SETTINGS";
const BOT_POLICIES_KEY = "BOT_INTELLIGENCE_POLICIES";
const BOT_FAQS_KEY = "BOT_INTELLIGENCE_FAQS";
const BOT_PLAYBOOKS_KEY = "BOT_INTELLIGENCE_PLAYBOOKS";

const DEFAULT_SETTINGS = {
  agencyName: "",
  dealershipName: "",
  financeApr: 0.75,
  botEnabled: false,
  maxReplyDelayMs: 2500,
  handoffPhoneNumber: "",
  handoffMessage: ""
};

type StoredItem = Record<string, any> & { id: string };

async function readSetting(key: string): Promise<Setting | null> {
  return Setting.findOne({ where: { key } });
}

async function writeSetting(key: string, value: any): Promise<void> {
  const serialized = JSON.stringify(value);
  const row = await readSetting(key);

  if (!row) {
    await Setting.create({ key, value: serialized });
    return;
  }

  if (row.value !== serialized) {
    await row.update({ value: serialized });
  }
}

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function withId<T extends Record<string, any>>(item: T): T & { id: string } {
  const id = String(item.id || Date.now());
  return { ...item, id };
}

async function readList(key: string): Promise<StoredItem[]> {
  const row = await readSetting(key);
  const list = parseJson<StoredItem[]>(row?.value, []);
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

async function writeList(key: string, list: StoredItem[]): Promise<void> {
  await writeSetting(key, list);
}

export async function getBotSettings(): Promise<Record<string, any>> {
  const row = await readSetting(BOT_SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...parseJson<Record<string, any>>(row?.value, {})
  };
}

export async function saveBotSettings(payload: Record<string, any>): Promise<Record<string, any>> {
  const current = await getBotSettings();
  const next = {
    ...current,
    ...(payload?.settings && typeof payload.settings === "object" ? payload.settings : payload)
  };
  await writeSetting(BOT_SETTINGS_KEY, next);
  return next;
}

export async function listPolicies(): Promise<StoredItem[]> {
  return readList(BOT_POLICIES_KEY);
}

export async function createPolicy(payload: Record<string, any>): Promise<StoredItem> {
  const current = await listPolicies();
  const next = withId({
    name: String(payload?.name || "").trim(),
    description: String(payload?.description || "").trim(),
    triggers: Array.isArray(payload?.triggers) ? payload.triggers : []
  });
  await writeList(BOT_POLICIES_KEY, [...current, next]);
  return next;
}

export async function deletePolicy(id: string): Promise<void> {
  const current = await listPolicies();
  await writeList(BOT_POLICIES_KEY, current.filter(item => String(item.id) !== String(id)));
}

export async function listFaqs(): Promise<StoredItem[]> {
  return readList(BOT_FAQS_KEY);
}

export async function createFaq(payload: Record<string, any>): Promise<StoredItem> {
  const current = await listFaqs();
  const next = withId({
    question: String(payload?.question || "").trim(),
    answer: String(payload?.answer || "").trim()
  });
  await writeList(BOT_FAQS_KEY, [...current, next]);
  return next;
}

export async function deleteFaq(id: string): Promise<void> {
  const current = await listFaqs();
  await writeList(BOT_FAQS_KEY, current.filter(item => String(item.id) !== String(id)));
}

export async function listPlaybooks(): Promise<StoredItem[]> {
  return readList(BOT_PLAYBOOKS_KEY);
}

export async function createPlaybook(payload: Record<string, any>): Promise<StoredItem> {
  const current = await listPlaybooks();
  const next = withId({
    intent: String(payload?.intent || "").trim(),
    description: String(payload?.description || "").trim(),
    template: String(payload?.template || "").trim()
  });
  await writeList(BOT_PLAYBOOKS_KEY, [...current, next]);
  return next;
}

export async function deletePlaybook(id: string): Promise<void> {
  const current = await listPlaybooks();
  await writeList(BOT_PLAYBOOKS_KEY, current.filter(item => String(item.id) !== String(id)));
}
