export { createObservationRecorderHook } from "./observation/recorder"
export { scrubSecrets, scrubAndTruncate } from "./observation/scrubber"
export {
  appendObservation,
  readObservationTail,
  countObservations,
  purgeOldObservations,
} from "./observation/storage"

export { buildStatisticalPatterns, computeToolFrequency, computeSequenceFrequency, getTopSequences } from "./pattern-engine/frequency-counter"
export { computeCoOccurrence, getTransitionProbability } from "./pattern-engine/co-occurrence"
export { computeBaseline, isSessionAnomalous } from "./pattern-engine/baseline"
export { analyzeObservations, runAnalysis, persistPatterns, loadPatterns } from "./pattern-engine/analyzer"

export { resolveProjectHash } from "./instinct-store/project-resolver"
export { confidenceFromObservationCount, applyDecay, shouldPromote, shouldEvict } from "./instinct-store/confidence"
export { parseInstinctFile, serializeInstinct } from "./instinct-store/instinct-parser"
export { listInstincts, listAllInstincts, saveInstinct, deleteInstinct, findInstinctById, buildInstinctIndex, extractKeywords } from "./instinct-store/storage"

export { shouldConsolidate, prepareConsolidationData } from "./consolidation/trigger"
export { buildExtractionPrompt } from "./consolidation/extraction-prompt"
export { createConsolidationHook } from "./consolidation/consolidation-hook"

export { selectTopInstincts, scoreRelevance } from "./injection/relevance-matcher"
export { createInstinctInjectorHook } from "./injection/instinct-injector"

export {
  createInstinctListTool,
  createInstinctAddTool,
  createInstinctExportTool,
  createInstinctDeleteTool,
} from "./create-instinct-tools"

export type {
  Observation,
  Instinct,
  InstinctIndex,
  StatisticalPatterns,
  ContinuousLearningConfig,
  InstinctDomain,
  InstinctSource,
  InstinctScope,
} from "./types"
export { DEFAULT_CL_CONFIG } from "./types"
