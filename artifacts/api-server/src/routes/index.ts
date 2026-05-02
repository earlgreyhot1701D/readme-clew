import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import scanRouter from "./scan.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scanRouter);

export default router;
