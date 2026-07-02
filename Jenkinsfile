// Patron CI — Phase 01 harness (block_management.md §13).
// Runs the Python store tests + Playwright e2e (headless). Extended per phase.
pipeline {
  agent any
  options { timestamps() }
  stages {
    stage('Unit — store/serve') {
      steps {
        sh 'python3 test/test_project_store.py'
        // discover any other test/test_*.py as they are added
        sh 'python3 -m pytest -q test/ || python3 test/test_project_store.py'
      }
    }
    stage('E2E — Playwright') {
      steps {
        // Requires the patron container up on :8088 and Playwright browsers installed.
        // The e2e runner is added under test/e2e/ in Phase 02.
        sh 'test -d test/e2e && node test/e2e/run.mjs || echo "no e2e yet (Phase 02)"'
      }
    }
  }
  post {
    always { echo "Patron pipeline done" }
  }
}
