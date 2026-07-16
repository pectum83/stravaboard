I want to create a new app named stravaBoard.
It will be a private web page deployed on my infomaniak vps.

A - Its functionalities:
1 - connect to my strava account through strava API
2 - recover my activities : by default at launch, recover all since last import
3 - store all my activities in a database
4 - in futures version there will be several graph and data displays, but for the first version we only have one page
5 - one page display containing
5-1- on left list of activities classes by date
5-2- when clic on one activiies displat its vertical speed graph
5-3 on the right main part, display the vertical speeds graph: vertical speed on y axis and km from beginning on horizontal axis
5-4 the vertical speeds are:
5-4-a the instant vertical speed computed on a 2 seconds
5-4-b the short term vertical speed computed on 60 sec
5-4-c the long term vertical speed computed on five minutes
5-4-d the ascent vertical speed: the mean vertical speed along a ascent (filtering the small descent inside)
5-4 the duration (2 sec, 60 sec, 5 min) are configurables in a settings field

B - Technologies
I would prefer using vue3 composition api full ts or vue4 if you have already enough skill on it.
But first propose best framework fior that anf lets discuss about it.

C - deployment
Lets first have a local app for test.
We will do deployement in a second time

D - quality
I want a business quality even it it is a personnal app. This mean full test plan and CI/CD
