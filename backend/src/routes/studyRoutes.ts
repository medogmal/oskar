import express from 'express';
import multer from 'multer';
import {
  createStudyRecord,
  evaluateStudyClinicallyRecord,
  getClinicalEvaluationQueue,
  getStudies,
  getStudyById,
  lockStudyRecord,
  getSupervisorReviewQueue,
  resubmitStudyRecord,
  reviewStudyRecord,
  updateStudyDesignRecord,
} from '../controllers/studyController.js';
import {
  approveOutcomeAssessmentTemplateVersionRecord,
  createResearcherAssessmentTemplateVersionRecord,
  createOutcomeAssessmentNoteRecord,
  createOutcomeAssessmentRequestsRecord,
  getOutcomeAssessmentOverviewRecord,
  getOutcomeAssessmentWorkspaceRecord,
  listOutcomeAssessmentNotesRecord,
  listOutcomeAssessmentRequestsForAssessorRecord,
  proposeOutcomeAssessmentTemplateRecord,
  respondToOutcomeAssessmentRequestRecord,
  saveOutcomeAssessmentEntryRecord,
  submitOutcomeAssessmentEntryRecord,
  upsertOutcomeAssessmentSamplesRecord,
} from '../controllers/outcomeAssessmentController.js';
import {
  downloadAnalysisReportWord,
  downloadStatisticianDatasetExport,
  downloadStatisticianDatasetExportXlsx,
  downloadAnalysisReportPdf,
  downloadStudyFile,
  getStudyAnalysesList,
  getStudyResources,
  runPersistedStudyAnalysis,
  uploadStudyFile,
} from '../controllers/studyResourceController.js';
import { protect } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  clinicalEvaluationValidator,
  createOutcomeAssessmentNoteValidator,
  createOutcomeAssessmentRequestValidator,
  createStudyValidator,
  proposeOutcomeAssessmentTemplateValidator,
  respondToOutcomeAssessmentRequestValidator,
  reviewStudyValidator,
  updateStudyDesignValidator,
  updateOutcomeAssessmentEntryValidator,
  upsertOutcomeAssessmentSamplesValidator,
} from '../validators/studyValidators.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

router.use(protect);
router.get('/outcome-assessment/assessor/requests', listOutcomeAssessmentRequestsForAssessorRecord);
router.post(
  '/outcome-assessment/assessor/requests/:requestId/respond',
  respondToOutcomeAssessmentRequestValidator,
  validateRequest,
  respondToOutcomeAssessmentRequestRecord,
);
router.get('/outcome-assessment/assessor/requests/:requestId/workspace', getOutcomeAssessmentWorkspaceRecord);
router.post(
  '/outcome-assessment/assessor/requests/:requestId/template',
  proposeOutcomeAssessmentTemplateValidator,
  validateRequest,
  proposeOutcomeAssessmentTemplateRecord,
);
router.get('/outcome-assessment/assessor/requests/:requestId/notes', listOutcomeAssessmentNotesRecord);
router.post(
  '/outcome-assessment/assessor/requests/:requestId/notes',
  createOutcomeAssessmentNoteValidator,
  validateRequest,
  createOutcomeAssessmentNoteRecord,
);
router.post(
  '/outcome-assessment/assessor/entries/:entryId/save',
  updateOutcomeAssessmentEntryValidator,
  validateRequest,
  saveOutcomeAssessmentEntryRecord,
);
router.post(
  '/outcome-assessment/assessor/entries/:entryId/submit',
  updateOutcomeAssessmentEntryValidator,
  validateRequest,
  submitOutcomeAssessmentEntryRecord,
);
router.get('/review/queue', getSupervisorReviewQueue);
router.get('/clinical-evaluation/queue', getClinicalEvaluationQueue);
router.get('/', getStudies);
router.get('/:id/outcome-assessment/overview', getOutcomeAssessmentOverviewRecord);
router.post(
  '/:id/outcome-assessment/requests',
  createOutcomeAssessmentRequestValidator,
  validateRequest,
  createOutcomeAssessmentRequestsRecord,
);
router.post(
  '/:id/outcome-assessment/template',
  proposeOutcomeAssessmentTemplateValidator,
  validateRequest,
  createResearcherAssessmentTemplateVersionRecord,
);
router.post(
  '/:id/outcome-assessment/samples',
  upsertOutcomeAssessmentSamplesValidator,
  validateRequest,
  upsertOutcomeAssessmentSamplesRecord,
);
router.get('/:id/outcome-assessment/requests/:requestId/notes', listOutcomeAssessmentNotesRecord);
router.post(
  '/:id/outcome-assessment/requests/:requestId/notes',
  createOutcomeAssessmentNoteValidator,
  validateRequest,
  createOutcomeAssessmentNoteRecord,
);
router.post('/:id/outcome-assessment/template/:versionId/approve', approveOutcomeAssessmentTemplateVersionRecord);
router.get('/:id/resources', getStudyResources);
router.get('/:id/analyses', getStudyAnalysesList);
router.get('/:id/analyses/:analysisId/report', downloadAnalysisReportPdf);
router.get('/:id/analyses/:analysisId/report-word', downloadAnalysisReportWord);
router.get('/:id/exports/statistician-dataset', downloadStatisticianDatasetExport);
router.get('/:id/exports/statistician-dataset.xlsx', downloadStatisticianDatasetExportXlsx);
router.get('/:id/files/:fileId/download', downloadStudyFile);
router.get('/:id', getStudyById);
router.post('/', createStudyValidator, validateRequest, createStudyRecord);
router.patch('/:id/design-settings', updateStudyDesignValidator, validateRequest, updateStudyDesignRecord);
router.post('/:id/lock', lockStudyRecord);
router.post('/:id/files', upload.single('file'), uploadStudyFile);
router.post('/:id/analysis/run', upload.single('file'), runPersistedStudyAnalysis);
router.post('/:id/review', reviewStudyValidator, validateRequest, reviewStudyRecord);
router.post('/:id/clinical-evaluation', clinicalEvaluationValidator, validateRequest, evaluateStudyClinicallyRecord);
router.post('/:id/resubmit', resubmitStudyRecord);

export default router;
