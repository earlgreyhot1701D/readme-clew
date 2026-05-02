import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import scanRouter from "./scan.js";
import ogRouter from "./og.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scanRouter);
router.use(ogRouter);

export default router;
