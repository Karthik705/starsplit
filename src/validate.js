// Input cleaning: every request body goes through here before touching the database.
const { CATEGORIES, SPLIT_TYPES } = require('./constants');
const { buildSplits } = require('./balance');
const { bad } = require('./errors');
const { memberIds } = require('./store');

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

const toCents = (v) => {
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n <= 0 || n > 1e10) throw bad('Amount must be a positive number');
  return n;
};

const today = () => new Date().toISOString().slice(0, 10);

const cleanDate = (v) => {
  if (v === undefined || v === '') return today();
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad('Invalid date');
  return v;
};

/**
 * Validate an expense payload and turn it into rows.
 * Body: { description, amount, paidBy, category, date?, splitType?, split }
 * where `split` maps memberId -> value (amount / percent / shares; ignored for equal).
 * For backwards compatibility `splitAmong: [ids]` means an equal split.
 */
async function parseExpense(body, groupId) {
  const valid = await memberIds(groupId);
  const description = cleanText(body.description, 60);
  const category = CATEGORIES.includes(body.category) ? body.category : 'other';
  const paidBy = Number(body.paidBy);
  const amount = toCents(body.amount);
  const splitType = SPLIT_TYPES.includes(body.splitType) ? body.splitType : 'equal';
  const date = cleanDate(body.date);

  if (!description) throw bad('Describe what this was for');
  if (!valid.has(paidBy)) throw bad('Unknown payer');

  let entries;
  if (body.split && typeof body.split === 'object') {
    entries = Object.entries(body.split).map(([id, v]) => ({
      member_id: Number(id),
      // exact amounts arrive as decimals, everything else is used as-is
      value: splitType === 'exact' ? Math.round(Number(v) * 100) : Number(v),
    }));
  } else {
    entries = (body.splitAmong || []).map((id) => ({ member_id: Number(id), value: 1 }));
  }
  entries = entries.filter((e) => splitType === 'equal' || e.value > 0);
  if (!entries.length) throw bad('Pick who shares this expense');
  if (!entries.every((e) => valid.has(e.member_id) && Number.isFinite(e.value) && e.value >= 0)) throw bad('Invalid split');
  if (new Set(entries.map((e) => e.member_id)).size !== entries.length) throw bad('Invalid split');

  let splits;
  try {
    splits = buildSplits(amount, splitType, entries);
  } catch (err) {
    throw bad(err.message);
  }
  return { description, category, paidBy, amount, date, splits };
}

module.exports = { cleanText, toCents, today, cleanDate, parseExpense };
