import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import scanRouter from "./scan.js";
import ogRouter from "./og.js";
import badgeRouter from "./badge.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scanRouter);
router.use(ogRouter);
router.use(badgeRouter);

export default router;
