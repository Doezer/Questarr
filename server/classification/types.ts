import {
  classifyReleaseByRules,
  type Classification,
  type ReleaseClassificationInput,
} from "../../shared/release-classification.js";

/**
 * One layer of the classification pipeline (rules, local model, cloud). Layers are
 * interchangeable and testable alone. A classifier only classifies: it never decides whether a
 * release may be downloaded, and it must resolve to a result rather than reject.
 */
export interface ReleaseClassifier {
  classify(input: ReleaseClassificationInput): Promise<Classification>;
}

/** The deterministic layer as a ReleaseClassifier. */
export const rulesClassifier: ReleaseClassifier = {
  classify: (input) => Promise.resolve(classifyReleaseByRules(input)),
};
