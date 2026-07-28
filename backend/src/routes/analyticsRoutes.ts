import express from 'express';
import multer from 'multer';
import {
  calculateKnowledgeSampleSize,
  extractDocumentText,
  getAnalyticsHealth,
  analyzeMissingData,
  getKnowledgeHealth,
  getKnowledgeReferences,
  getKnowledgeStudyTypes,
  ingestKnowledgeDocument,
  profileDataset,
  queryKnowledgeBase,
  reindexKnowledgeReferences,
  recommendAnalysis,
  runAnalysis,
  runAssistantChat,
  runOcrExtraction,
  validateKnowledgeClinicalParameters,
} from '../controllers/analyticsController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

router.use(protect);
router.get('/health', getAnalyticsHealth);
router.get('/knowledge/health', getKnowledgeHealth);
router.get('/knowledge/study-types', getKnowledgeStudyTypes);
router.get('/knowledge/references', getKnowledgeReferences);
router.get('/knowledge/references/:studyType', getKnowledgeReferences);
router.post('/profile', upload.single('file'), profileDataset);
router.post('/recommend', recommendAnalysis);
router.post('/run', upload.single('file'), runAnalysis);
router.post('/missing-data', upload.single('file'), analyzeMissingData);
router.post('/ocr', upload.single('file'), runOcrExtraction);
router.post('/document/extract-text', upload.single('file'), extractDocumentText);
router.post('/assistant/chat', runAssistantChat);
router.post('/knowledge/ingest', upload.single('file'), ingestKnowledgeDocument);
router.post('/knowledge/reindex', reindexKnowledgeReferences);
router.post('/knowledge/query', queryKnowledgeBase);
router.post('/knowledge/sample-size', calculateKnowledgeSampleSize);
router.post('/knowledge/validate-clinical', validateKnowledgeClinicalParameters);


export default router;
