import { Router } from 'express';
import { simulateInvoke } from '../services/simulationEngine.js';
import { profileResources } from '../services/resourceProfiler.js';
import { visualizeGas } from '../services/gasVisualizer.js';

const router = Router();

router.post('/simulate', async (req, res, next) => {
  try {
    const { contractId, method, args, sourceAccount } = req.body ?? {};
    if (!contractId || !method) {
      return res.status(400).json({ error: 'contractId and method are required' });
    }
    const simulation = await simulateInvoke({ contractId, method, args, sourceAccount });
    const profile = profileResources(simulation);
    const gas = visualizeGas(simulation);
    return res.json({ simulation, profile, gas });
  } catch (err) {
    return next(err);
  }
});

export default router;
