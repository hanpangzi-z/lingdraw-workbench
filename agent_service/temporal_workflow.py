from __future__ import annotations

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy


@activity.defn(name="agent-plan-run")
async def plan_run_activity(run_id: str) -> dict:
    import os
    import httpx

    base_url = os.getenv("AGENT_INTERNAL_API_URL", "http://127.0.0.1:37621").rstrip("/")
    token = os.getenv("AGENT_INTERNAL_TOKEN", "")
    async with httpx.AsyncClient(timeout=600) as client:
        response = await client.post(
            f"{base_url}/api/agent/internal/runs/{run_id}/plan",
            headers={"X-Agent-Internal-Token": token},
        )
        response.raise_for_status()
        return response.json()


@activity.defn(name="agent-execute-run")
async def execute_run_activity(run_id: str) -> dict:
    import os
    import asyncio
    import httpx

    base_url = os.getenv("AGENT_INTERNAL_API_URL", "http://127.0.0.1:37621").rstrip("/")
    token = os.getenv("AGENT_INTERNAL_TOKEN", "")
    async def heartbeat_loop():
        while True:
            activity.heartbeat({"run_id": run_id})
            await asyncio.sleep(30)

    heartbeat = asyncio.create_task(heartbeat_loop())
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            response = await client.post(
                f"{base_url}/api/agent/internal/runs/{run_id}/execute",
                headers={"X-Agent-Internal-Token": token},
            )
            response.raise_for_status()
            return response.json()
    finally:
        heartbeat.cancel()


@workflow.defn(name="DesignRunWorkflow")
class DesignRunWorkflow:
    def __init__(self):
        self.plan_approved = False
        self.first_result_approved = False
        self.publish_approved = False
        self.paused = False
        self.cancelled = False

    @workflow.signal(name="approve_plan")
    async def approve_plan(self):
        self.plan_approved = True

    @workflow.signal(name="approve_first_result")
    async def approve_first_result(self):
        self.first_result_approved = True

    @workflow.signal(name="approve_publish")
    async def approve_publish(self):
        self.publish_approved = True

    @workflow.signal(name="pause")
    async def pause(self):
        self.paused = True

    @workflow.signal(name="resume")
    async def resume(self):
        self.paused = False

    @workflow.signal(name="cancel")
    async def cancel(self):
        self.cancelled = True

    @workflow.run
    async def run(self, run_id: str) -> dict:
        retry = RetryPolicy(initial_interval=timedelta(seconds=2), backoff_coefficient=2.0, maximum_attempts=3)
        await workflow.execute_activity(
            plan_run_activity,
            run_id,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry,
        )
        await workflow.wait_condition(lambda: self.plan_approved or self.cancelled)
        if self.cancelled:
            return {"run_id": run_id, "status": "cancelled"}
        await workflow.wait_condition(lambda: not self.paused or self.cancelled)
        if self.cancelled:
            return {"run_id": run_id, "status": "cancelled"}
        await workflow.execute_activity(
            execute_run_activity,
            run_id,
            start_to_close_timeout=timedelta(hours=2),
            heartbeat_timeout=timedelta(minutes=2),
            retry_policy=retry,
        )
        await workflow.wait_condition(lambda: self.first_result_approved or self.cancelled)
        if self.cancelled:
            return {"run_id": run_id, "status": "cancelled"}
        await workflow.wait_condition(lambda: self.publish_approved or self.cancelled)
        return {"run_id": run_id, "status": "cancelled" if self.cancelled else "publish_ready"}
