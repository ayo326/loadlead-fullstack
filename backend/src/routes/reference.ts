// Public read-only reference endpoints for the equipment + load taxonomies.
// These are the single source of truth for every dropdown in the app — the
// frontend never carries hardcoded lists. Server-side q= search on the large
// lists (models, commodities) keeps the wire small.

import { Router } from 'express';
import {
  getEquipmentClasses,
  getEquipmentClass,
  getModelsForClass,
  searchModels,
  getLoadModes,
  getServiceTypes,
  getCommodityCategories,
  getCommodities,
  searchCommodities,
  getAccessorials,
  getHazmatClasses,
} from '../services/taxonomyLoader';

const router = Router();

router.get('/equipment-classes', (_req, res) => {
  res.json({ items: getEquipmentClasses() });
});

router.get('/equipment-classes/:code', (req, res) => {
  const cls = getEquipmentClass(req.params.code);
  if (!cls) return res.status(404).json({ error: 'unknown equipment class' });
  return res.json({ item: cls });
});

router.get('/equipment-models', (req, res) => {
  const cls = String(req.query.class ?? '').trim();
  const q   = String(req.query.q ?? '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10) || 25));
  if (!cls) return res.status(400).json({ error: 'class query param is required' });

  // When q is present we return a flat [{manufacturer, model}] list (good for combobox);
  // otherwise we return the grouped {manufacturer: [models]} shape.
  if (q) {
    return res.json({ items: searchModels(cls, q, limit) });
  }
  return res.json({ byManufacturer: getModelsForClass(cls) });
});

router.get('/load-modes',    (_req, res) => res.json({ items: getLoadModes() }));
router.get('/service-types', (_req, res) => res.json({ items: getServiceTypes() }));

router.get('/commodities', (req, res) => {
  const q   = String(req.query.q ?? '').trim();
  const cat = String(req.query.category ?? '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10) || 25));

  let items = q ? searchCommodities(q, limit) : getCommodities();
  if (cat) items = items.filter(c => c.category === cat);
  res.json({
    categories: getCommodityCategories(),
    items: q ? items : items.slice(0, limit),
  });
});

router.get('/accessorials',   (_req, res) => res.json({ items: getAccessorials() }));
router.get('/hazmat-classes', (_req, res) => res.json({ items: getHazmatClasses() }));

export default router;
