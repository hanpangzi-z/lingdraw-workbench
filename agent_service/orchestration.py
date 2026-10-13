from __future__ import annotations

import os


class LocalOrchestrator:
    def __init__(self, service):
        self.service = service

    async def start(self, run_id: str):
        self.service.spawn(f"plan:{run_id}", self.service.plan_run(run_id))

    async def signal(self, run_id: str, signal_name: str):
        if signal_name == "approve_plan":
            self.service.spawn(f"execute:{run_id}", self.service.execute_run(run_id))


class TemporalOrchestrator:
    def __init__(self, address: str, namespace: str, task_queue: str):
        self.address = address
        self.namespace = namespace
        self.task_queue = task_queue
        self._client = None

    async def client(self):
        if self._client is None:
            from temporalio.client import Client
            self._client = await Client.connect(self.address, namespace=self.namespace)
        return self._client

    async def start(self, run_id: str):
        client = await self.client()
        await client.start_workflow(
            "DesignRunWorkflow",
            run_id,
            id=f"design-run-{run_id}",
            task_queue=self.task_queue,
        )

    async def signal(self, run_id: str, signal_name: str):
        client = await self.client()
        handle = client.get_workflow_handle(f"design-run-{run_id}")
        await handle.signal(signal_name)


def build_orchestrator(service, mode: str):
    if mode == "temporal":
        return TemporalOrchestrator(
            os.getenv("TEMPORAL_ADDRESS", "127.0.0.1:7233"),
            os.getenv("TEMPORAL_NAMESPACE", "default"),
            os.getenv("TEMPORAL_TASK_QUEUE", "lingdraw-design-agent"),
        )
    return LocalOrchestrator(service)
