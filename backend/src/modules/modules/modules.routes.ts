import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { modulesForRole } from './modules.registry.js';

export const modulesRouter = Router();

modulesRouter.get('/', requireAuth, (req, res) => {
  res.json({ modules: modulesForRole(req.user!.role) });
});
