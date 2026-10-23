import assert from "node:assert/strict";

export const fixtureDisclosure =
	"Scripted disposable QA fixture; human actions are simulated test setup, not a real user's approval or an AI work session.";
export const qaHumanName = "Smoke QA human (simulated)";
export const qaAgentName = "Smoke QA worker";

export function taskContext(task) {
	assert.ok(
		task.key && task.claimGeneration && task.updatedAt,
		"Task context is incomplete",
	);
	return {
		key: task.key,
		expectedClaimGeneration: task.claimGeneration,
		expectedUpdatedAt: task.updatedAt,
	};
}

export function nativeTaskContext(task) {
	assert.ok(task.key && task.updatedAt, "Native task context is incomplete");
	return { key: task.key, expectedUpdatedAt: task.updatedAt };
}

export function reviewContext(task) {
	assert.equal(
		task.status,
		"review",
		"Inspect the report while the task is in Review",
	);
	const reports = task.reports.filter(
		(report) => report.round === task.reviewRound,
	);
	assert.equal(reports.length, 1, "Inspect exactly one current-round report");
	assert.ok(reports[0].id, "Report ID must not be empty");
	assert.ok(
		task.reviewContextRevision,
		"Review context must be captured in Review",
	);
	return {
		key: task.key,
		expectedReportId: reports[0].id,
		expectedReviewContextRevision: task.reviewContextRevision,
	};
}

export function assertCurrentContract(initialized, listed, expectedVersion) {
	assert.equal(
		initialized.serverInfo?.name,
		"jam-board",
		"Unexpected MCP server",
	);
	assert.equal(
		initialized.serverInfo?.version,
		expectedVersion,
		"Sidecar version differs from this checkout",
	);
	const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
	for (const name of [
		"claim_task",
		"move_task",
		"mark_ready",
		"archive_task",
		"update_task",
		"update_task_brief",
	]) {
		for (const field of ["expectedClaimGeneration", "expectedUpdatedAt"]) {
			assert.ok(
				tools.get(name)?.inputSchema.required?.includes(field),
				`${name} must require ${field}`,
			);
		}
	}
	for (const name of ["submit_report", "release_task"]) {
		assert.ok(
			tools
				.get(name)
				?.inputSchema.required?.includes("expectedClaimGeneration"),
			`${name} must require claim context`,
		);
	}
	for (const field of ["expectedReportId", "expectedReviewContextRevision"]) {
		assert.ok(
			tools.get("review_task")?.inputSchema.required?.includes(field),
			`review_task must require ${field}`,
		);
	}
	for (const name of [
		"set_execution",
		"resolve_execution_request",
		"start_execution",
	]) {
		assert.ok(
			!tools.has(name),
			"MCP must not expose a synthetic approval bypass",
		);
	}
}

export function epicFixture() {
	return {
		title: "Disposable smoke fixture",
		goalMd: "Verify the installed native/MCP contract on fresh QA data only.",
		doneWhenMd:
			"Captured context, execution gate, report and independent review checks pass.",
		notIncludedMd:
			"No actual product work, external workers, publication or user approval.",
		decidedMd: fixtureDisclosure,
	};
}

export function storyFixture(epicKey) {
	return {
		epicKey,
		title: "Exercise the current work lifecycle",
		outcomeMd: "One scripted task passes the current isolated protocol checks.",
		acceptance: [
			{
				id: "smoke-contract",
				criterion: "Current validators and explicit scope Start are required.",
				mandatory: true,
				check: "Inspect captured requests and fail closed on stale context.",
			},
		],
	};
}

export function taskFixture(storyKey) {
	return {
		storyKey,
		title: "Smoke fixture: verify current task contracts",
		tags: ["qa"],
		goalMd:
			"Exercise the supported task lifecycle without performing product work.",
		contextMd: fixtureDisclosure,
		whereMd: "This disposable QA database only.",
		changes: [
			{
				title: "Protocol fixture",
				required:
					"Use complete planning context and captured validators; never refresh and replay a stale decision.",
			},
		],
		tests: [
			{
				setup: "Attempt a claim while the exact story is paused.",
				expected: "execution_required, with no new claim.",
			},
			{
				setup:
					"Capture task and scope context, simulate native QA Start, claim and report.",
				expected:
					"A separate simulated QA human reviews the exact report/context.",
			},
		],
		boundariesMd:
			"No real user data or approval. No external worker processes or product changes.",
		resultMd:
			"Report protocol evidence and explicitly name unrun Windows/user-data checks.",
	};
}

export async function expectToolFailure(tool, name, args, code) {
	await assert.rejects(
		() => tool(name, args),
		(error) => error.code === code,
		`${name} should fail with ${code}`,
	);
}

// Preconditions are captured once for each decision. An error terminates the
// scenario: there is deliberately no refresh/retry wrapper around mutations.
export async function runInstalledWorkflow({
	tool,
	invoke,
	qaHumanId,
	onCreated = async () => {},
	onClaimed = async () => {},
}) {
	assert.ok(
		qaHumanId,
		"The preflight-verified simulated human identity is required",
	);
	const epic = await tool("create_epic", epicFixture());
	await invoke("set_epic_status", {
		input: { key: epic.key, status: "active" },
	});
	const story = await tool("create_story", storyFixture(epic.key));
	await invoke("set_story_status", {
		input: { key: story.key, status: "active" },
	});
	const started = Date.now();
	const created = await tool("create_task", taskFixture(story.key));
	await onCreated(created, started);
	const backlog = await tool("get_task", { key: created.key });
	await invoke("move_task", {
		input: { ...nativeTaskContext(backlog), status: "backlog" },
	});
	const readyDecision = await tool("get_task", { key: created.key });
	await invoke("mark_ready", {
		input: { ...nativeTaskContext(readyDecision), overrideReason: null },
	});
	const beforeStart = await tool("get_task", { key: created.key });
	await expectToolFailure(
		tool,
		"claim_task",
		taskContext(beforeStart),
		"execution_required",
	);
	const scope = { type: "story", id: story.id };
	const paused = await tool("get_execution", { scope });
	assert.equal(paused.effectiveState, "paused");
	// This is ONLY the explicitly labelled QA human in a proved-fresh fixture.
	await invoke("set_execution", {
		input: { scope, action: "start", expectedRevision: paused.revision },
	});
	const running = await tool("get_execution", { scope });
	assert.equal(running.effectiveState, "running");
	const claimDecision = await tool("get_task", { key: created.key });
	const claimed = await tool("claim_task", taskContext(claimDecision));
	assert.equal(claimed.status, "in_progress");
	await onClaimed(claimed);
	await tool("add_comment", { key: created.key, body: fixtureDisclosure });
	const report = await tool("submit_report", {
		key: claimed.key,
		expectedClaimGeneration: claimed.claimGeneration,
		summaryMd:
			"Scripted protocol fixture only: observed the paused claim rejection and the separately simulated native QA Start/claim. No product implementation was performed.",
		changedFiles: [],
		tests: [
			{
				name: "paused-scope",
				command: "claim_task with captured context before QA Start",
				expected: "execution_required",
				actual: "execution_required",
				result: "PASS",
			},
			{
				name: "installed-lifecycle",
				command: "native QA Start then MCP claim_task",
				expected: "in_progress",
				actual: claimed.status,
				result: "PASS",
			},
		],
		notVerifiedMd:
			"This fixture is not an AI work session or real user approval. Installer/uninstaller retention and cleanup are separate parent-run checks; no result for them is claimed here.",
	});
	const reviewDecision = await tool("get_task", { key: created.key });
	const context = reviewContext(reviewDecision);
	assert.equal(context.expectedReportId, report.id);
	const review = await invoke("review_task", {
		input: {
			...context,
			verdict: "accept",
			commentsMd:
				"Simulated independent QA human inspected this protocol fixture report and its complete brief; no product implementation is being accepted.",
			failedTests: [],
		},
	});
	assert.equal(
		review.reviewerId,
		qaHumanId,
		"Only the verified simulated QA human may review this fixture",
	);
	assert.notEqual(
		review.reviewerId,
		claimed.assigneeId,
		"Fixture reviewer must be independent",
	);
	assert.equal(review.verdict, "accept");
	const completed = await tool("get_task", { key: created.key });
	assert.equal(completed.status, "done");
	return {
		key: created.key,
		epicKey: epic.key,
		storyKey: story.key,
		claimed,
		reportId: report.id,
		reviewerId: review.reviewerId,
		independentReview: true,
		fixture: fixtureDisclosure,
	};
}
