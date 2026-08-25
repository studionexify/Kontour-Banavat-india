/* models.js — which model reads the bill.
 *
 * Two providers, because they fail differently: when one is rate limited,
 * having the other a tap away is the difference between logging the bill
 * now and logging it later. The wire shape stays Anthropic's either way —
 * the server translates for Gemini — so nothing downstream of readBill()
 * has to know which one answered.
 *
 * The lists below are a shortlist, not a limit. Anything typed into the
 * custom field is sent through as-is, so a model released after this file
 * was written works without a code change.
 */

export const PROVIDERS = {
  claude: {
    label: 'Claude',
    /* Verified against the Anthropic model list. These ids are complete
       as written — a date suffix is not appended to them. */
    models: [
      { id: 'claude-opus-5', label: 'Opus 5', note: 'Most accurate on faint or crowded bills' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', note: 'Cheaper, still very capable' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: 'Fastest and cheapest' },
    ],
    keyEnv: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    label: 'Gemini',
    /* Google renames and retires these faster than Anthropic does, so
       treat the shortlist as a starting point: the current ids for an
       account are listed in Google AI Studio, and any of them can be
       typed into the custom field. */
    models: [
      { id: 'gemini-2.5-flash', label: '2.5 Flash', note: 'Fast and cheap; fine for clear bills' },
      { id: 'gemini-2.5-pro', label: '2.5 Pro', note: 'Better on messy handwriting' },
    ],
    keyEnv: 'GEMINI_API_KEY',
  },
};

export const DEFAULT_PROVIDER = 'claude';

export function providerOf(id) {
  return PROVIDERS[id] ? id : DEFAULT_PROVIDER;
}

export function defaultModel(provider) {
  return PROVIDERS[providerOf(provider)].models[0].id;
}

/** True when `model` is not one of the shortlisted ids for that provider. */
export function isCustomModel(provider, model) {
  if (!model) return false;
  return !PROVIDERS[providerOf(provider)].models.some((m) => m.id === model);
}
