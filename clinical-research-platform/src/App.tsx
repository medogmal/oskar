import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import PWAInstallPrompt from './components/PWAInstallPrompt';

const SubscriptionPlans = lazy(() => import('./pages/SubscriptionPlans'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const CoResearcherDashboard = lazy(() => import('./pages/CoResearcherDashboard'));
const SupervisorDashboard = lazy(() => import('./pages/SupervisorDashboard'));
const AssistantSupervisorDashboard = lazy(() => import('./pages/AssistantSupervisorDashboard'));
const ClinicalEvaluatorDashboard = lazy(() => import('./pages/ClinicalEvaluatorDashboard'));
const InstitutionDashboard = lazy(() => import('./pages/InstitutionDashboard'));
const Studies = lazy(() => import('./pages/Studies'));
const OutcomeAssessmentWorkspace = lazy(() => import('./pages/OutcomeAssessmentWorkspace'));
const StudyDashboard = lazy(() => import('./pages/StudyDashboard'));
const AssessmentFormBuilder = lazy(() => import('./pages/AssessmentFormBuilder'));
const AIChat = lazy(() => import('./pages/AIChat'));
const VariableMappingMatrix = lazy(() => import('./pages/VariableMappingMatrix'));
const ErrorSeverityDashboard = lazy(() => import('./pages/ErrorSeverityDashboard'));
const AnalyticsWorkspace = lazy(() => import('./pages/AnalyticsWorkspace'));
const StudyStructureBuilder = lazy(() => import('./pages/StudyStructureBuilder'));
const ProjectGovernance = lazy(() => import('./pages/ProjectGovernance'));
const ReferencesWorkspace = lazy(() => import('./pages/KnowledgeReferences'));
const ExampleCasesWorkspace = lazy(() => import('./pages/ReferencesAndExtras').then(m => ({ default: m.ExampleCasesWorkspace })));
const DeveloperToolsWorkspace = lazy(() => import('./pages/ReferencesAndExtras').then(m => ({ default: m.DeveloperToolsWorkspace })));
const enableDevTools = import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true';

function App() {
  return (
    <Router>
      <AuthProvider>
        <PWAInstallPrompt />
        <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/subscriptions" element={<SubscriptionPlans />} />

            <Route element={<ProtectedRoute publicOnly />}>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['student']} />}>
              <Route path="/student-dashboard" element={<StudentDashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['co_researcher']} />}>
              <Route path="/co-researcher-dashboard" element={<CoResearcherDashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['student', 'co_researcher', 'supervisor', 'assistant_supervisor', 'clinical_evaluator', 'institution']} />}>
              <Route path="/studies" element={<Studies />} />
              <Route path="/studies/:id" element={<StudyDashboard />} />
              <Route path="/studies/:id/variable-matrix" element={<VariableMappingMatrix />} />
              <Route path="/studies/:id/issues" element={<ErrorSeverityDashboard />} />
              <Route path="/studies/:id/analytics" element={<AnalyticsWorkspace />} />
              <Route path="/studies/:id/structure-builder" element={<StudyStructureBuilder />} />
              <Route path="/studies/:id/governance" element={<ProjectGovernance />} />
              <Route path="/ai-chat" element={<AIChat />} />
              <Route path="/knowledge/references" element={<ReferencesWorkspace />} />
              <Route path="/knowledge/example-cases" element={<ExampleCasesWorkspace />} />
              {enableDevTools ? <Route path="/dev/schema-and-trees" element={<DeveloperToolsWorkspace />} /> : null}
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['supervisor']} />}>
              <Route path="/supervisor-dashboard" element={<SupervisorDashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['assistant_supervisor']} />}>
              <Route path="/assistant-supervisor-dashboard" element={<AssistantSupervisorDashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['clinical_evaluator']} />}>
              <Route path="/clinical-evaluator-dashboard" element={<ClinicalEvaluatorDashboard />} />
              <Route path="/outcome-assessment/:requestId" element={<OutcomeAssessmentWorkspace />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['student', 'co_researcher', 'supervisor', 'assistant_supervisor']} />}>
              <Route path="/studies/:id/assessment-form" element={<AssessmentFormBuilder />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['institution']} />}>
              <Route path="/institution-dashboard" element={<InstitutionDashboard />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

export default App;
