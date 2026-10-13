import asyncio
import unittest
from unittest.mock import patch

import httpx
import main


class SeedreamGatewaySizeTests(unittest.TestCase):
    def test_gateway_payload_meets_minimum_without_shrinking_valid_sizes(self):
        bodies = []

        class Client:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def request(self, method, url, **kwargs):
                bodies.append(kwargs['json'])
                return httpx.Response(200, json={'data': [{'url': 'https://example.invalid/result.png'}]},
                                      request=httpx.Request(method, url))

        provider = {'id': 'test', 'name': 'Test', 'base_url': 'https://example.invalid/v1',
                    'protocol': 'openai', 'image_request_mode': 'openai'}
        with patch.object(main, 'get_api_provider', return_value=provider), \
                patch.object(main, 'provider_env_key_value', return_value='test'), \
                patch.object(main.httpx, 'AsyncClient', Client):
            for model, size in [('doubao-seedream-4-5-251128', '1024x1024'),
                                ('doubao-seedream-4-5-251128', '1536x1024'),
                                ('doubao-seedream-4-5-251128', '4096x4096'),
                                ('gpt-image-2', '1024x1024')]:
                asyncio.run(main.generate_ai_image('cube', size, 'auto', model, provider_id='test'))

        for body in bodies[:2]:
            w, h = map(int, body['size'].split('x'))
            self.assertGreaterEqual(w * h, 3686400)
        self.assertEqual(bodies[2]['size'], '4096x4096')
        self.assertEqual(bodies[3]['size'], '1024x1024')
        self.assertEqual(len(bodies), 4)
