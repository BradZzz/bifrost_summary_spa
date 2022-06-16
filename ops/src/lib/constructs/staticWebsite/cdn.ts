import { Construct } from "constructs"
import { Token } from "cdktf"

import {
  AcmCertificate,
  CloudfrontDistribution,
  CloudfrontOriginAccessIdentity,
  DataAwsIamPolicyDocument,
  S3BucketPolicy,
  S3BucketPublicAccessBlock,
  S3Bucket,
} from "../../../imports/providers/aws"

/**
 * Represents the properties of the CDN construct.
 * @property acmCertificate The ACM certificate created for your website.
 * @property domainNames The domain names covered by the ACM certificate.
 * @property enableHttps Do HTTPS needs to be enabled?
 * @property hasBuildCommand Do your website has a build command?
 * @property resourceNamesPrefix An unique custom prefix used to avoid name colision with existing resources.
 * @property websiteS3Bucket The S3 bucket containing your website source code.
 */
export interface ICdnConstructProps {
  acmCertificate: AcmCertificate;
  domainNames: string[];
  enableHttps: boolean;
  hasBuildCommand: boolean;
  resourceNamesPrefix: string;
  websiteS3Bucket: S3Bucket;
}

/**
 * Represents the CloudFront distribution used as CDN for your website.
 * @class
 * @extends Construct
 */
class CdnConstruct extends Construct {
  /**
   * The CloudFront distribution created for your website.
   */
  readonly cloudfrontDistribution: CloudfrontDistribution

  /**
   * Creates a CDN construct.
   * @param scope The scope to attach the CDN construct to.
   * @param id An unique id used to distinguish constructs.
   * @param props The CDN construct properties.
   */
  constructor(scope: Construct, id: string, props: ICdnConstructProps) {
    super(scope, id)

    const websiteOriginID = props.resourceNamesPrefix

    const cloudfrontOriginAccessIdentity = new CloudfrontOriginAccessIdentity(this, 'cloudfront_OAI',{
        comment: "bifrost_summary"
    })

    const buildRolePolicyDocument = new DataAwsIamPolicyDocument(this, 'cloudfront_OAI_role_policy_document', {
      version: "2012-10-17",
      statement: [{
        effect: "Allow",
        actions: [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:ListBucket",
          "s3:GetBucketAcl",
          "s3:GetBucketLocation",
        ],
        resources: [
          Token.asString(props.websiteS3Bucket.arn),
          `${Token.asString(props.websiteS3Bucket.arn)}/*`,
        ],
        principals: [{
          type: "AWS",
          identifiers: [cloudfrontOriginAccessIdentity.iamArn]
        }]
      }]
    })

    new S3BucketPolicy(this,'cloudfront_s3_bucket_policy',{
      bucket: Token.asString(props.websiteS3Bucket.id),
      policy: buildRolePolicyDocument.json
    })

    new S3BucketPublicAccessBlock(this,'cloudfront_s3_bucket_public_access_block',{
      bucket: Token.asString(props.websiteS3Bucket.id),
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: false
    })

    const cloudfrontDistribution = new CloudfrontDistribution(this, "cloudfront_distribution", {
      enabled: true,
      defaultRootObject: "index.html",
      aliases: props.enableHttps ? props.domainNames : undefined,
      origin: [{
        domainName: props.websiteS3Bucket.bucketRegionalDomainName,
        originId: websiteOriginID,
        s3OriginConfig:[{
            originAccessIdentity:cloudfrontOriginAccessIdentity.cloudfrontAccessIdentityPath
        }]
      }],
      customErrorResponse: [{
        // If the routing is managed by a SPA framework
        // all paths must be forwarded to "index.html".
        // If the object isn’t in the bucket, S3 returns a 403 error.
        // Must match "errorDocument" website bucket property.
        errorCode: 403,
        responseCode: props.hasBuildCommand ? 200 : 403,
        responsePagePath: props.hasBuildCommand ? "/index.html" : "/error.html",
      }],
      defaultCacheBehavior: [{
        targetOriginId: websiteOriginID,
        allowedMethods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
        cachedMethods: ["GET", "HEAD"],
        viewerProtocolPolicy: "redirect-to-https",
        forwardedValues: [{
          queryString: false,
          cookies: [{
            forward: "none",
          }],
        }],
      }],
      restrictions: [{
        geoRestriction: [{
          restrictionType: "none",
        }],
      }],
      // HTTPS activation is a two-step process because
      // ACM certificates need to be "issued"
      // before attaching to a Cloudfront distribution
      viewerCertificate: [props.enableHttps ? {
        acmCertificateArn: Token.asString(props.acmCertificate.id),
        sslSupportMethod: "sni-only",
      } : {
        cloudfrontDefaultCertificate: true,
      }],
      dependsOn: [
        props.websiteS3Bucket,
      ],
    })

    this.cloudfrontDistribution = cloudfrontDistribution
  }
}

export default CdnConstruct
