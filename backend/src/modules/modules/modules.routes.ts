import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { modulesForRoles } from './modules.registry.js';

export const modulesRouter = Router();

modulesRouter.get('/', requireAuth, (req, res) => {
  res.json({ modules: modulesForRoles(req.user!.roles.map((r) => r.name)) });
});
