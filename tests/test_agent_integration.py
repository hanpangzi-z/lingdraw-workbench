import os
import unittest
import uuid

from agent_service.db import AgentStore


@unittest.skipUnless(os.getenv("AGENT_TEST_POSTGRES_URL"), "set AGENT_TEST_POSTGRES_URL for integration test")
class PostgreSQLAgentStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_migrated_store_round_trip(self):
        store = AgentStore(os.environ["AGENT_TEST_POSTGRES_URL"], auto_create=False)
        try:
            await store.initialize()
            owner_id = int(uuid.uuid4().int % 2_000_000_000)
            created = await store.create_project(owner_id, "integration-user", "PostgreSQL integration")
            projects = await store.list_projects(owner_id)
            self.assertEqual([item["id"] for item in projects], [created["id"]])
        finally:
            await store.close()


@unittest.skipUnless(os.getenv("TEMPORAL_TEST_ADDRESS"), "set TEMPORAL_TEST_ADDRESS for integration test")
class TemporalWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_workflow_completes_and_history_replays(self):
        from temporalio import activity
        from temporalio.client import Client
        from temporalio.worker import Replayer, Worker

        from agent_service.temporal_workflow import DesignRunWorkflow

        @activity.defn(name="agent-plan-run")
        async def fake_plan(run_id: str) -> dict:
            return {"run_id": run_id, "status": "awaiting_approval"}

        @activity.defn(name="agent-execute-run")
        async def fake_execute(run_id: str) -> dict:
            return {"run_id": run_id, "status": "awaiting_approval"}

        address = os.environ["TEMPORAL_TEST_ADDRESS"]
        client = await Client.connect(address)
        task_queue = f"design-agent-test-{uuid.uuid4().hex}"
        workflow_id = f"design-agent-replay-{uuid.uuid4().hex}"
        async with Worker(
            client,
            task_queue=task_queue,
            workflows=[DesignRunWorkflow],
            activities=[fake_plan, fake_execute],
        ):
            handle = await client.start_workflow(
                DesignRunWorkflow.run,
                "run_integration",
                id=workflow_id,
                task_queue=task_queue,
            )
            await handle.signal(DesignRunWorkflow.approve_plan)
            await handle.signal(DesignRunWorkflow.approve_first_result)
            await handle.signal(DesignRunWorkflow.approve_publish)
            result = await handle.result()
            self.assertEqual(result["status"], "publish_ready")
            history = await handle.fetch_history()

        replay = await Replayer(workflows=[DesignRunWorkflow]).replay_workflow(history)
        self.assertIsNone(replay.replay_failure)


if __name__ == "__main__":
    unittest.main()
