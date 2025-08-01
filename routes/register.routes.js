import { Router } from "express";
import upload from "../middleware/mullter.middleware.js";
import { InsertRegistration } from "../controller/registation.controller.js";
const router = Router();

router.route('/').post(upload.fields([
    { name: 'passport_photo', maxCount: 1 },
    { name: 'uid_aadhaar', maxCount: 1 },
    { name: 'school_id', maxCount: 1 }
]), InsertRegistration);

export default router;

