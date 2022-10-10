import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as appsync from '@aws-cdk/aws-appsync-alpha'
import * as path from 'path'
import {
	ServicePrincipal,
	Role,
	PolicyDocument,
	PolicyStatement,
	ArnPrincipal,
} from 'aws-cdk-lib/aws-iam'

export class APIStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props)

		const api = new appsync.GraphqlApi(this, 'Api', {
			name: 'apiSecret',
			schema: appsync.Schema.fromAsset(path.join(__dirname, 'schema.graphql')),
			authorizationConfig: {
				defaultAuthorization: {
					authorizationType: appsync.AuthorizationType.API_KEY,
					apiKeyConfig: {
						name: 'getSSMAPIKey',
					},
				},
			},
			logConfig: {
				fieldLogLevel: appsync.FieldLogLevel.ALL,
			},
			xrayEnabled: true,
		})

		const allowGetSecretName = new PolicyDocument({
			statements: [
				new PolicyStatement({
					resources: [api.arn],
					actions: ['secretsmanager:GetSecretValue'],
				}),
			],
		})

		new Role(this, 'appsyncWithSSMGet', {
			assumedBy: new ServicePrincipal('appsync.amazonaws.com'),
			inlinePolicies: {
				allowGetSecretName: allowGetSecretName,
			},
		})

		const ssmDS = api.addHttpDataSource(
			'toSecretManager',
			'https://secretsmanager.us-east-1.amazonaws.com',
			{
				authorizationConfig: {
					signingRegion: 'us-east-1',
					signingServiceName: 'secretsmanager',
				},
			}
		)

		ssmDS.grantPrincipal.addToPrincipalPolicy(
			new PolicyStatement({
				resources: [
					'arn:aws:secretsmanager:us-east-1:521776702104:secret:SecretId-P2Z1pP',
				],
				actions: ['secretsmanager:GetSecretValue'],
			})
		)

		const appSyncFunction = new appsync.AppsyncFunction(
			this,
			'getSecretFromSSM',
			{
				api,
				dataSource: ssmDS,
				name: 'fetchSecretFromSSM',
				requestMappingTemplate: appsync.MappingTemplate.fromFile(
					path.join(__dirname, 'mappingTemplates/Query.getSecret.req.vtl')
				),
				responseMappingTemplate: appsync.MappingTemplate.fromFile(
					path.join(__dirname, 'mappingTemplates/Query.getSecret.res.vtl')
				),
			}
		)

		const myPipelineResolver = new appsync.Resolver(this, 'mySecretPipeline', {
			api,
			typeName: 'Query',
			fieldName: 'getSecret',
			requestMappingTemplate: appsync.MappingTemplate.fromFile(
				path.join(__dirname, 'mappingTemplates/Pipeline.Before.req.vtl')
			),
			pipelineConfig: [appSyncFunction],
			responseMappingTemplate: appsync.MappingTemplate.fromFile(
				path.join(__dirname, 'mappingTemplates/Pipeline.After.res.vtl')
			),
		})
	}
}