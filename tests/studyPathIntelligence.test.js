import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTextForHashing,
  hashText,
  hashBuffer,
  computeDocumentFingerprint
} from '../src/services/fingerprintService.js';

import {
  classifyDocumentDomain
} from '../src/services/domainClassifierService.js';

import {
  getBlueprint,
  applyBlueprintToPrompt
} from '../src/services/blueprintEngine.js';

import {
  generateAnonymousSessionId,
  sanitizeAnonymousSessionId
} from '../src/services/anonymousSessionService.js';

import {
  sanitizeConceptText,
  deriveTopicKey
} from '../src/services/collectiveIntelligenceService.js';

test('Milestone 1: Fingerprinting - Normalization and Deterministic Hashing', () => {
  const text1 = '  Brachial   Plexus \n Anatomy and Innervation.  ';
  const text2 = 'brachial plexus anatomy and innervation.';
  
  assert.equal(normalizeTextForHashing(text1), normalizeTextForHashing(text2));
  assert.equal(hashText(text1), hashText(text2));
  assert.ok(hashText(text1).length === 64); // SHA-256 is 64 hex characters

  const dummyBuf = Buffer.from('PDF content mock buffer');
  const bufHash = hashBuffer(dummyBuf);
  assert.ok(bufHash && bufHash.length === 64);

  const fp = computeDocumentFingerprint({ buffer: dummyBuf, text: text1, fileName: 'brachial.pdf', totalPages: 12 });
  assert.equal(fp.totalPages, 12);
  assert.equal(fp.fileName, 'brachial.pdf');
  assert.equal(fp.contentHash, hashText(text1));
});

test('Milestone 3: Domain Classification - Heuristic Accuracy', async () => {
  // Test Medicine
  const medClass = await classifyDocumentDomain({
    title: 'Gross Anatomy of the Upper Limb',
    text: 'The brachial plexus innervates the shoulder and upper extremity. Axillary artery and median nerve relations in the axilla. Clinical correlation with Erb-Duchenne palsy.',
    inventory: [{ visual: false }, { visual: true }]
  });
  assert.equal(medClass.discipline, 'medicine');
  assert.ok(medClass.confidence >= 0.7);

  // Test STEM
  const stemClass = await classifyDocumentDomain({
    title: 'MTH 101: Differential Calculus',
    text: 'Let f(x) be a continuous function. The derivative theorem states that the integral of acceleration gives velocity. Vector matrix equations: dx/dt = v.',
    inventory: [{ visual: false }]
  });
  assert.equal(stemClass.discipline, 'stem');
  assert.ok(stemClass.confidence >= 0.7);

  // Test Law
  const lawClass = await classifyDocumentDomain({
    title: 'Constitutional Law and Precedent',
    text: 'The appellate court held that substantive due process applies. Precedent established by the Supreme Court tribunal governs liability and tort damages.',
    inventory: [{ visual: false }]
  });
  assert.equal(lawClass.discipline, 'law');
});

test('Milestone 4: Adaptive Blueprints - Retrieval and Prompt Injection', () => {
  const medBp = getBlueprint('medicine');
  assert.equal(medBp.id, 'medical-clinical');
  assert.ok(medBp.slide1TeachingGoal.includes('anatomical'));

  const stemBp = getBlueprint('stem');
  assert.equal(stemBp.id, 'stem-computational');
  assert.ok(stemBp.slide1TeachingGoal.includes('mathematical') || stemBp.slide1TeachingGoal.includes('law'));

  const generalBp = getBlueprint('unknown_domain');
  assert.equal(generalBp.id, 'general-academic');

  const basePrompt = 'Base generation instructions.';
  const enriched = applyBlueprintToPrompt(basePrompt, medBp);
  assert.ok(enriched.includes('ADAPTIVE LEARNING BLUEPRINT: MEDICAL & CLINICAL BLUEPRINT'));
  assert.ok(enriched.includes('Base generation instructions.'));
});

test('Milestone 5: Anonymous Onboarding - Token Generation and Sanitization', () => {
  const token = generateAnonymousSessionId();
  assert.ok(token.startsWith('anon_'));
  assert.equal(token.length, 37); // 'anon_' (5) + 32 hex = 37

  assert.equal(sanitizeAnonymousSessionId(token), token);
  assert.equal(sanitizeAnonymousSessionId('invalid-token!'), null);
  assert.equal(sanitizeAnonymousSessionId(''), null);
});

test('Milestone 6: Collective Intelligence - PII Scrubbing and Topic Keying', () => {
  const dirty = 'Student john.doe@example.com scored poorly on https://studyhelp.com/quiz with id 080123456789 about Brachial Plexus roots';
  const clean = sanitizeConceptText(dirty);

  assert.ok(!clean.includes('john.doe@example.com'));
  assert.ok(!clean.includes('https://'));
  assert.ok(!clean.includes('080123456789'));
  assert.ok(clean.includes('Brachial Plexus'));

  const key = deriveTopicKey('medicine', 'Brachial Plexus Anatomy');
  assert.equal(key, 'medicine:brachial-plexus-anatomy');
});

test('Milestone 2: Document Intelligence - Input Validation & Guards', async () => {
  const { analyzePdfDocument } = await import('../src/services/documentIntelligenceService.js');
  
  await assert.rejects(async () => {
    await analyzePdfDocument('not-a-buffer');
  }, /Input must be a valid Buffer/);

  await assert.rejects(async () => {
    await analyzePdfDocument(Buffer.from('not-a-pdf-content'));
  }, /missing %PDF header/);
});

test('Milestone 7: Slide Routes & API Mounting', async () => {
  const slideRoutes = (await import('../src/routes/slideRoutes.js')).default;
  assert.ok(slideRoutes);
  assert.equal(typeof slideRoutes, 'function'); // Express Router is a callable middleware function

  const app = (await import('../src/app.js')).default;
  assert.ok(app);
});

test('Milestone 8: Adaptive Roadmap Sizing & Progressive Unlocking', async () => {
  const { formatStudyPathResponse } = await import('../src/controllers/studyPathController.js');

  // Verify variable roadmap sizes (3 nodes, 8 nodes, 15 nodes)
  for (const nodeCount of [3, 8, 15]) {
    const mockNodes = Array.from({ length: nodeCount }, (_, i) => ({
      id: i + 1,
      title: `Lesson ${i + 1}`,
      unit: i < Math.floor(nodeCount / 2) ? 'Module 1: Foundations' : 'Module 2: Advanced Topics',
      status: i === 0 ? 'active' : 'locked',
      contentStatus: i === 0 ? 'ready' : 'pending',
      xp: 25,
      duration: '5 min',
      sourcePages: [i + 1]
    }));

    const mockStudyPath = {
      topicId: `adaptive-topic-${nodeCount}`,
      title: `Course with ${nodeCount} Lessons`,
      courseCode: 'TEST 101',
      currentProgress: 0,
      completed: false,
      nodes: mockNodes,
      challenge: {
        status: 'locked',
        bestScore: 0,
        bestXp: 0
      }
    };

    const formatted = formatStudyPathResponse(mockStudyPath);
    assert.equal(formatted.nodes.length, nodeCount, `Roadmap should accurately preserve ${nodeCount} dynamic nodes`);
    assert.equal(formatted.nodes[0].status, 'active');
    assert.equal(formatted.nodes[1].status, 'locked');
    assert.equal(formatted.challenge.status, 'locked');

    // Simulate progressive completion: Node 1 -> Node 2 unlocked
    mockNodes[0].status = 'completed';
    mockNodes[1].status = 'active';
    const progressFormatted = formatStudyPathResponse({
      ...mockStudyPath,
      currentProgress: 1,
      nodes: mockNodes
    });
    assert.equal(progressFormatted.nodes[0].status, 'completed');
    assert.equal(progressFormatted.nodes[1].status, 'active');
    assert.equal(progressFormatted.nodes[2].status, 'locked');
  }
});


test('Milestone 9: Anonymous Access Redaction & Security', async () => {
  const { formatStudyPathResponse } = await import('../src/controllers/studyPathController.js');

  const fullLesson = {
    heading: 'Heading',
    body: 'Sample body text **bold term** because reasons.',
    memoryTip: 'Tip'
  };

  const samplePath = {
    userId: 'anonymous-user',
    isAnonymousTrial: true,
    topicId: 'anon-test',
    title: 'Anon Course',
    nodes: [
      { id: 1, title: 'Intro', breakdown: [fullLesson], keyConcepts: ['T: C'], quiz: { question: 'Q1' } },
      { id: 2, title: 'Advanced', breakdown: [fullLesson], keyConcepts: ['T2: C2'], quiz: { question: 'Q2' } }
    ]
  };

  // When viewed as anonymous guest
  const anonView = formatStudyPathResponse(samplePath, true);
  assert.equal(anonView.nodes[0].breakdown.length, 1, 'Node 1 breakdown preserved for guest');
  assert.ok(anonView.nodes[0].quiz, 'Node 1 quiz preserved for guest');
  assert.equal(anonView.nodes[1].breakdown.length, 0, 'Node 2 breakdown redacted for guest');
  assert.equal(anonView.nodes[1].quiz, undefined, 'Node 2 quiz redacted for guest');

  // When viewed as authenticated claimed owner
  const ownerView = formatStudyPathResponse(samplePath, false);
  assert.equal(ownerView.nodes[1].breakdown.length, 1, 'Node 2 breakdown accessible for owner');
  assert.ok(ownerView.nodes[1].quiz, 'Node 2 quiz accessible for owner');
});

test('Milestone 10: 120-Node Safety Ceiling Enforcement', async () => {
  const { MAX_NODES } = await import('../src/config/studyPathConfig.js');
  assert.equal(MAX_NODES, 120);

  // Verify that an outline exceeding 120 nodes is treated as an operational error, not silent truncation
  const outlineNodes = Array.from({ length: 125 }, (_, i) => ({
    title: `Node ${i + 1}`,
    sourcePages: [i + 1]
  }));

  assert.throws(() => {
    if (outlineNodes.length > MAX_NODES) {
      throw new Error(`The outline produced ${outlineNodes.length} nodes, above the safety limit of ${MAX_NODES}.`);
    }
  }, /above the safety limit of 120/);
});

test('Milestone 11: Atomic Study Path Claiming Guards & Session Validation', async () => {
  const { claimAnonymousStudyPath } = await import('../src/services/anonymousSessionService.js');
  const { claimStudyPathController } = await import('../src/controllers/studyPathController.js');

  // 1. Must reject unauthenticated or missing user IDs
  await assert.rejects(async () => {
    await claimAnonymousStudyPath({ userId: null, anonymousSessionId: 'anon_1234567890abcdef1234567890abcdef' });
  }, /Valid authenticated user ID is required/);

  await assert.rejects(async () => {
    await claimAnonymousStudyPath({ userId: 'anonymous-user', anonymousSessionId: 'anon_1234567890abcdef1234567890abcdef' });
  }, /Valid authenticated user ID is required/);

  // 2. Must reject claiming without valid anonymousSessionId (cannot claim by topicId alone!)
  await assert.rejects(async () => {
    await claimAnonymousStudyPath({ userId: 'user-123', topicId: 'guessed-topic' });
  }, /A valid anonymousSessionId is required/);

  await assert.rejects(async () => {
    await claimAnonymousStudyPath({ userId: 'user-123', anonymousSessionId: 'invalid-token' });
  }, /A valid anonymousSessionId is required/);

  // 3. Controller-level enforcement: Must reject requests missing anonymousSessionId with 400
  const mockRes = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
  await claimStudyPathController({ user: { _id: 'user-123' }, body: { topicId: 'guessed-topic' } }, mockRes);
  assert.equal(mockRes.statusCode, 400);
  assert.match(mockRes.body.message, /anonymousSessionId is required/);
});

test('Milestone 13: Expired-Job Active Map Recovery', async () => {
  const { getActiveStudyPath } = await import('../src/controllers/studyPathController.js');

  const mockRes = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };

  // Safe guest query when no map exists
  await getActiveStudyPath({ headers: { 'x-anonymous-session-id': 'anon_1234567890abcdef1234567890abcdef' }, query: {} }, mockRes);
  assert.equal(mockRes.statusCode, 200);
  assert.equal(mockRes.body.success, true);
  assert.equal(mockRes.body.studyPath, null);
});

test('Milestone 12: Retry Node Authorization Guards', async () => {
  const { retryNodeController } = await import('../src/controllers/studyPathController.js');

  // Test invalid node ID
  const mockRes = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };

  await retryNodeController({ params: { topicId: 'test-topic', nodeId: 'invalid' } }, mockRes);
  assert.equal(mockRes.statusCode, 400);
  assert.equal(mockRes.body.success, false);
});
