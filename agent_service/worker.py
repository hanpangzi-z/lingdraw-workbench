from __future__ import annotations

import asyncio
import logging
import os

from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.api.workflowservice.v1 import DescribeNamespaceRequest

from .temporal_workflow import DesignRunWorkflow, execute_run_activity, plan_run_activity


async def run_worker():
    address = os.getenv("TEMPORAL_ADDRESS", "127.0.0.1:7233")
    namespace = os.getenv("TEMPORAL_NAMESPACE", "default")
    delay = 1
    while True:
        try:
            client = await Client.connect(address, namespace=namespace)
            await client.workflow_service.describe_namespace(DescribeNamespaceRequest(namespace=namespace))
            break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.getLogger(__name__).warning("Temporal is not ready (%s); retrying in %ss", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)
    worker = Worker(
        client,
        task_queue=os.getenv("TEMPORAL_TASK_QUEUE", "lingdraw-design-agent"),
        workflows=[DesignRunWorkflow],
        activities=[plan_run_activity, execute_run_activity],
        max_concurrent_activities=int(os.getenv("AGENT_MAX_CONCURRENT_ACTIVITIES", "8")),
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(run_worker())
